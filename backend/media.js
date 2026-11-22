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
var kinocheck = require('./kinocheck');

var KEY_PATTERN = /^[A-Za-z0-9_-]{11}$/;
var FORMAT = 'bv*[vcodec^=avc1][height<=1080]+ba[acodec^=mp4a]/b[ext=mp4]';
var running = Object.create(null);
var busy = 0;
var skipped = new Set(); // keys not replaced this process (failed or already HEVC)
var reprocessing = null;

// Cutting is off unless KINOCHECK_TRIM=1 (opt-in, see README). The detector (kinocheck.js) matches
// KinoCheck's logo animation and red end card by signature; an end it cannot match stays uncut.
var MIN_KEEP = 30;               // never cut a trailer down below this many seconds
var INTRO_SECONDS = 3.6;         // the ident ends at ~3.05 s; decode a little past it
var OUTRO_SECONDS = 24;          // the end card is 15 s at most; decode its start and the trailer's last seconds
var SCAN_TIMEOUT = 5 * 60 * 1000;
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


function exec(run, cmd, args, timeout, binary) {
  return new Promise(function (resolve, reject) {
    var options = { timeout: timeout, maxBuffer: 32 * 1024 * 1024 };
    if (binary) options.encoding = 'buffer';
    run(cmd, args, options, function (error, stdout, stderr) {
      if (error) reject(error);
      else resolve({ stdout: binary ? Buffer.from(stdout || '') : String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

// ffmpeg always runs under nice so it never competes with /api/stream or an import.
function ffmpeg(run, args, timeout, binary) {
  return exec(run, 'nice', ['-n', '19', 'ffmpeg', '-hide_banner', '-nostats', '-y'].concat(args), timeout, binary);
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

// Decodes the frames of one part of the file as tiny raw frames, with their real timestamps (showinfo)
// so a cut lands between two frames. `input` is the ffmpeg input part (-t / -ss, -i file).
async function sampleFrames(run, input, width, height, pixFmt) {
  var size = width * height * (pixFmt === 'gray' ? 1 : 3);
  var re = /\bn:\s*\d+\s+pts:\s*-?\d+\s+pts_time:(-?[\d.]+)/g;
  for (var attempt = 1; ; attempt += 1) {
    var out = await ffmpeg(run, input.concat(['-an', '-vf', 'scale=' + width + ':' + height + ':flags=area,showinfo',
      '-fps_mode', 'passthrough', '-f', 'rawvideo', '-pix_fmt', pixFmt, '-']), SCAN_TIMEOUT, true);
    var times = [], match;
    re.lastIndex = 0;
    while ((match = re.exec(out.stderr))) times.push(Number(match[1]));
    if (times.length > 0 && times.length * size === out.stdout.length) {
      return times.map(function (t, i) { return { t: t, data: out.stdout.subarray(i * size, (i + 1) * size) }; });
    }
    // seen on a busy host in about 1 scan in 30: one showinfo line missing from stderr; a second try is clean
    if (attempt === 2) throw new Error('unexpected frame data from ffmpeg (' + times.length + ' timestamps, ' + out.stdout.length + ' bytes of ' + size + ' per frame)');
  }
}

// Returns {start, end} (seconds, either may be null = uncut) for a KinoCheck trailer.
async function findCuts(run, file, duration) {
  var intro = await sampleFrames(run, ['-t', String(INTRO_SECONDS), '-i', file], kinocheck.GRAY_W, kinocheck.GRAY_H, 'gray');
  var outro = await sampleFrames(run, ['-ss', String(Math.max(0, duration - OUTRO_SECONDS)), '-copyts', '-start_at_zero', '-i', file],
    kinocheck.RGB_W, kinocheck.RGB_H, 'rgb24');
  var start = kinocheck.findIntroEnd(intro);
  var end = kinocheck.findOutroStart(outro);
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
    var cuts = { start: null, end: null };
    if (isKinoCheck && process.env.KINOCHECK_TRIM === '1') {
      try { cuts = await findCuts(run, file, before.duration); } catch (error) { logger.warn('ident scan ' + path.basename(file) + ' failed, not cutting: ' + error.message); }
    }
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
async function ensureTitleTrailer(db, mediaType, tmdbId, options) {
  var logger = (options && options.logger) || console;
  for (;;) {
    var candidates = db.prepare('SELECT * FROM candidates WHERE media_type = ? AND tmdb_id = ?').all(mediaType, tmdbId);
    var picked = gate.pickTrailer(candidates);
    db.prepare('UPDATE titles SET trailer_key = ? WHERE media_type = ? AND tmdb_id = ?').run(picked ? picked.key : null, mediaType, tmdbId);
    if (!picked) return null;
    try {
      await download(picked.key, Object.assign({ db: db }, options));
      return picked.key;
    } catch (error) {
      logger.warn('trailer ' + mediaType + ' ' + tmdbId + ' ' + picked.key + ' unavailable: ' + error.message);
      db.prepare('UPDATE candidates SET playable = 0, reason = ? WHERE media_type = ? AND tmdb_id = ? AND key = ?')
        .run('unavailable for download: ' + error.message, mediaType, tmdbId, picked.key);
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
  var ids = db.prepare('SELECT media_type, tmdb_id FROM titles WHERE trailer_key IS NOT NULL ORDER BY media_type, tmdb_id').all();
  var ready = 0;
  for (var i = 0; i < ids.length; i += 1) {
    if (await ensureTitleTrailer(db, ids[i].media_type, ids[i].tmdb_id, options)) ready += 1;
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
  findCuts: findCuts,
  processFile: processFile,
  reprocessCached: reprocessCached,
  working: working
};
