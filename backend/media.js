'use strict';

// Trailer cache for the TV app (ADR: the app plays a stream URL itself, no YouTube player).
// Each picked YouTube trailer is downloaded once with yt-dlp as an H.264/AAC MP4 into MEDIA_DIR,
// which nginx serves at /media/. LAN-only, private household use (see the ADR's terms note).

var fs = require('fs');
var path = require('path');
var execFile = require('child_process').execFile;
var gate = require('./gate');

var KEY_PATTERN = /^[A-Za-z0-9_-]{11}$/;
var FORMAT = 'bv*[vcodec^=avc1][height<=1080]+ba[acodec^=mp4a]/b[ext=mp4]';
var running = Object.create(null);

function mediaDir(env) {
  return (env || process.env).MEDIA_DIR || '/data/media';
}

function mediaUrl(key) {
  return '/media/' + key + '.mp4';
}

function isCached(key, env) {
  return fs.existsSync(path.join(mediaDir(env), key + '.mp4'));
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
      fs.renameSync(partial, target);
      resolve(target);
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
      await download(picked.key, options);
      return picked.key;
    } catch (error) {
      logger.warn('trailer ' + tmdbId + ' ' + picked.key + ' unavailable: ' + error.message);
      db.prepare('UPDATE candidates SET playable = 0, reason = ? WHERE tmdb_id = ? AND key = ?')
        .run('unavailable for download: ' + error.message, tmdbId, picked.key);
    }
  }
}

async function prefetchAll(db, options) {
  var ids = db.prepare('SELECT tmdb_id FROM titles WHERE trailer_key IS NOT NULL ORDER BY tmdb_id').all();
  var ready = 0;
  for (var i = 0; i < ids.length; i += 1) {
    if (await ensureTitleTrailer(db, ids[i].tmdb_id, options)) ready += 1;
  }
  return { titles: ids.length, ready: ready };
}

module.exports = {
  KEY_PATTERN: KEY_PATTERN,
  download: download,
  ensureTitleTrailer: ensureTitleTrailer,
  isCached: isCached,
  mediaUrl: mediaUrl,
  prefetchAll: prefetchAll
};
