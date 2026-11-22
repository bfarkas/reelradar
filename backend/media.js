'use strict';

// Trailer cache for the TV app (ADR: the app plays a stream URL itself, no YouTube player).
// Each picked YouTube trailer is downloaded once with yt-dlp as an H.264/AAC MP4 into MEDIA_DIR,
// which nginx serves at /media/. LAN-only, private household use (see the ADR's terms note).
// After the download the file is transcoded to HEVC (hvc1) + AAC + faststart, and KinoCheck's own
// ident at the start and end is cut off when it can be found. Any failure keeps the original.

var fs = require('fs');
var path = require('path');
var execFile = require('child_process').execFile;
var gate = require('./gate');

var KEY_PATTERN = /^[A-Za-z0-9_-]{11}$/;
var FORMAT = 'bv*[vcodec^=avc1][height<=1080]+ba[acodec^=mp4a]/b[ext=mp4]';
var running = Object.create(null);
var busy = 0;
var skipped = new Set(); // keys not replaced this process (failed or already HEVC)
var reprocessing = null;

// KinoCheck ident detection: a black frame run bracketing the ident. shortcut: tuned by eye, not on
// real files; an end is cut only if a black run sits inside its window, else that end stays uncut.
var INTRO_BLACK_START_MIN = 1.5; // black must begin after at least this much ident
var INTRO_BLACK_END_MAX = 12;    // and end within this many seconds of the start
var OUTRO_FROM_END_MAX = 8;      // outro black begins within the last 8 s ...
var OUTRO_FROM_END_MIN = 2.5;    // ... but not in the final fade-out
var MIN_KEEP = 30;               // never cut a trailer down below this many seconds
var TRANSCODE_TIMEOUT = 30 * 60 * 1000;

function mediaDir(env) {
  return (env || process.env).MEDIA_DIR || '/data/media';
}

function mediaUrl(key) {
  return '/media/' + key + '.mp4';
}

function isCached(key, env) {
  return fs.existsSync(path.join(mediaDir(env), key + '.mp4'));
}


function exec(run, cmd, args, timeout) {
  return new Promise(function (resolve, reject) {
    run(cmd, args, { timeout: timeout, maxBuffer: 16 * 1024 * 1024 }, function (error, stdout, stderr) {
      if (error) reject(error);
      else resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

// ffmpeg always runs under nice so it never competes with /api/stream or an import.
function ffmpeg(run, args, timeout) {
  return exec(run, 'nice', ['-n', '19', 'ffmpeg', '-hide_banner', '-nostats', '-y'].concat(args), timeout);
}

async function probe(run, file) {
  var out = await exec(run, 'ffprobe', ['-v', 'error', '-show_entries',
    'stream=codec_type,codec_name,codec_tag_string:format=duration', '-of', 'json', file], 60 * 1000);
  var info = JSON.parse(out.stdout);
  var streams = info.streams || [];
  return {
    video: streams.filter(function (s) { return s.codec_type === 'video'; })[0],
    audio: streams.filter(function (s) { return s.codec_type === 'audio'; })[0],
    duration: Number(info.format && info.format.duration)
  };
}

// Returns {start, end} (seconds, either may be null = uncut) for a KinoCheck trailer.
async function findCuts(run, file, duration) {
  var out = await ffmpeg(run, ['-i', file, '-an', '-vf', 'blackdetect=d=0.04:pix_th=0.1', '-f', 'null', '-'], TRANSCODE_TIMEOUT);
  var blacks = [];
  var re = /black_start:([\d.]+)\s+black_end:([\d.]+)/g;
  var match;
  while ((match = re.exec(out.stderr))) blacks.push({ start: Number(match[1]), end: Number(match[2]) });
  var intro = blacks.filter(function (b) { return b.start >= INTRO_BLACK_START_MIN && b.end <= INTRO_BLACK_END_MAX; })[0];
  var outro = blacks.filter(function (b) {
    return b.start <= duration - OUTRO_FROM_END_MIN && b.start >= duration - OUTRO_FROM_END_MAX && b.start > (intro ? intro.end : 0);
  })[0];
  var start = intro ? intro.end : null;
  var end = outro ? outro.start : null;
  if ((end === null ? duration : end) - (start || 0) < MIN_KEEP) return { start: null, end: null };
  return { start: start, end: end };
}

// Transcodes `file` in place to HEVC/AAC/faststart (cutting KinoCheck idents). The original is
// replaced only by a complete, ffprobe-validated result; on any failure it is left as it is.
// Resolves true if the file was replaced, false otherwise; never rejects.
async function processFile(file, isKinoCheck, options) {
  var run = (options && options.execFile) || execFile;
  var logger = (options && options.logger) || console;
  var temp = file.replace(/\.mp4$/, '.proc.mp4');
  try {
    var before = await probe(run, file);
    if (!before.video || !(before.duration > 0)) throw new Error('unreadable source');
    if (before.video.codec_name === 'hevc' && before.video.codec_tag_string === 'hvc1') return false; // already processed
    var cuts = isKinoCheck ? await findCuts(run, file, before.duration) : { start: null, end: null };
    var args = ['-i', file];
    if (cuts.start !== null) args.push('-ss', String(cuts.start));
    if (cuts.end !== null) args.push('-to', String(cuts.end));
    args.push('-c:v', 'libx265', '-preset', 'fast', '-crf', '26', '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1',
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-f', 'mp4', temp);
    await ffmpeg(run, args, TRANSCODE_TIMEOUT);
    var after = await probe(run, temp);
    var expected = (cuts.end === null ? before.duration : cuts.end) - (cuts.start || 0);
    var ok = after.video && after.video.codec_name === 'hevc' && after.video.codec_tag_string === 'hvc1' &&
      (!before.audio || (after.audio && after.audio.codec_name === 'aac')) &&
      Math.abs(after.duration - expected) <= 2;
    if (!ok) throw new Error('transcoded file failed validation');
    fs.renameSync(temp, file);
    return true;
  } catch (error) {
    logger.warn('transcode ' + path.basename(file) + ' failed, keeping original: ' + error.message);
    return false;
  } finally {
    fs.rmSync(temp, { force: true });
  }
}

function isKinoCheckKey(db, key) {
  return !!db.prepare("SELECT 1 FROM candidates WHERE key = ? AND source IN ('kinocheck', 'both')").get(key);
}

// Downloads one video; concurrent calls for the same key share one download.
function download(key, options) {
  options = options || {};
  if (!KEY_PATTERN.test(key)) return Promise.reject(new Error('invalid video key'));
  var dir = mediaDir(options.env);
  var target = path.join(dir, key + '.mp4');
  if (fs.existsSync(target)) return Promise.resolve(target);
  if (running[key]) return running[key];

  fs.mkdirSync(dir, { recursive: true });
  var partial = path.join(dir, key + '.part.mp4');
  var run = options.execFile || execFile;
  running[key] = new Promise(function (resolve, reject) {
    run('yt-dlp', ['-q', '--no-warnings', '--no-playlist', '-f', FORMAT,
      '--merge-output-format', 'mp4', '-o', partial, '--', key],
    { timeout: 5 * 60 * 1000 }, function (error, stdout, stderr) {
      if (error) {
        fs.rmSync(partial, { force: true });
        var lines = String(stderr || error.message).trim().split('\n');
        // yt-dlp prints hints after the ERROR line; keep the ERROR line as the reason.
        reject(new Error(lines.filter(function (line) { return /^ERROR:/.test(line); }).pop() || lines.pop()));
        return;
      }
      var kinoCheck = options.db ? isKinoCheckKey(options.db, key) : false;
      processFile(partial, kinoCheck, options).then(function () {
        fs.renameSync(partial, target);
        resolve(target);
      }).catch(reject);
    });
  }).finally(function () { delete running[key]; });
  return running[key];
}

// Ensures a title has a downloadable trailer: tries the picked one, and if YouTube refuses it
// (private, removed, region-locked), marks that candidate unplayable and picks the next one.
async function ensureTitleTrailer(db, tmdbId, options) {
  var logger = (options && options.logger) || console;
  for (;;) {
    var candidates = db.prepare('SELECT * FROM candidates WHERE tmdb_id = ?').all(tmdbId);
    var picked = gate.pickTrailer(candidates);
    db.prepare('UPDATE titles SET trailer_key = ? WHERE tmdb_id = ?').run(picked ? picked.key : null, tmdbId);
    if (!picked) return null;
    try {
      await download(picked.key, Object.assign({ db: db }, options));
      return picked.key;
    } catch (error) {
      logger.warn('trailer ' + tmdbId + ' ' + picked.key + ' unavailable: ' + error.message);
      db.prepare('UPDATE candidates SET playable = 0, reason = ? WHERE tmdb_id = ? AND key = ?')
        .run('unavailable for download: ' + error.message, tmdbId, picked.key);
    }
  }
}

async function prefetchAll(db, options) {
  return working(function () { return prefetchTitles(db, options); });
}

// Marks imports/prefetches as running so reprocessCached stays out of their way.
async function working(fn) {
  busy += 1;
  try { return await fn(); } finally { busy -= 1; }
}

async function prefetchTitles(db, options) {
  var ids = db.prepare('SELECT tmdb_id FROM titles WHERE trailer_key IS NOT NULL ORDER BY tmdb_id').all();
  var ready = 0;
  for (var i = 0; i < ids.length; i += 1) {
    if (await ensureTitleTrailer(db, ids[i].tmdb_id, options)) ready += 1;
  }
  return { titles: ids.length, ready: ready };
}

// One-at-a-time background pass over files cached before transcoding existed. Waits while any
// download, import or prefetch runs; a file left as it is is not retried until the process restarts.
function reprocessCached(db, options) {
  if (reprocessing) return reprocessing;
  options = options || {};
  var dir = mediaDir(options.env);
  reprocessing = (async function () {
    var done = { replaced: 0, kept: 0 };
    var files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(function (f) { return /^[A-Za-z0-9_-]{11}\.mp4$/.test(f); }) : [];
    for (var i = 0; i < files.length; i += 1) {
      var key = files[i].slice(0, 11);
      if (skipped.has(key)) continue;
      while (busy > 0 || Object.keys(running).length > 0) {
        await new Promise(function (resolve) { setTimeout(resolve, options.pollMs || 30000); });
      }
      var replaced = await processFile(path.join(dir, files[i]), isKinoCheckKey(db, key), options);
      if (replaced) done.replaced += 1; else done.kept += 1;
      if (!replaced) skipped.add(key);
    }
    return done;
  })().finally(function () { reprocessing = null; });
  return reprocessing;
}

module.exports = {
  KEY_PATTERN: KEY_PATTERN,
  download: download,
  ensureTitleTrailer: ensureTitleTrailer,
  isCached: isCached,
  mediaUrl: mediaUrl,
  prefetchAll: prefetchAll,
  processFile: processFile,
  reprocessCached: reprocessCached,
  working: working
};
