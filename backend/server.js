'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');
var DatabaseSync = require('node:sqlite').DatabaseSync;
var importer = require('./import');
var media = require('./media');
var scheduler = require('./scheduler');
var seerr = require('./seerr').createClient({});
var seerrCache = { at: 0, value: null };

var dbPath = process.env.DB_PATH || '/data/reelradar.db';
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
var db = new DatabaseSync(dbPath, { timeout: 15000 }); // import and prefetch write from other processes
db.exec('PRAGMA journal_mode = WAL'); // persists in the file; readers no longer block writers
db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL)');
db.exec("INSERT INTO meta (key, value) VALUES ('boot_count', 1) " +
  'ON CONFLICT(key) DO UPDATE SET value = value + 1');
importer.ensureSchema(db);
var boots = db.prepare("SELECT value FROM meta WHERE key = 'boot_count'").get().value;
var started = new Date().toISOString();

function sendJson(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}

function getTitles() {
  var rows = db.prepare([
    'SELECT t.*, c.kinocheck_url, c.published_at AS trailer_published_at FROM titles t',
    'LEFT JOIN candidates c ON c.media_type = t.media_type AND c.tmdb_id = t.tmdb_id AND c.key = t.trailer_key',
    'ORDER BY t.de_theatrical IS NULL, t.de_theatrical, t.title, t.media_type'
  ].join(' ')).all();
  var decisionStatement = db.prepare([
    'SELECT key, source, playable, reason FROM candidates',
    'WHERE media_type = ? AND tmdb_id = ? ORDER BY key'
  ].join(' '));
  var tagStatement = db.prepare('SELECT tag_id AS id, name FROM title_tags WHERE media_type = ? AND tmdb_id = ? AND kind = ? ORDER BY name');

  return rows.map(function (row) {
    return {
      media_type: row.media_type, // 'movie' | 'tv'; ids repeat between the two, so identity is (media_type, tmdb_id)
      tmdb_id: row.tmdb_id,
      title: row.title,
      original_title: row.original_title,
      original_language: row.original_language,
      de_theatrical: row.de_theatrical,
      de_digital: row.de_digital,
      poster_path: row.poster_path || null,
      backdrop_path: row.backdrop_path || null,
      overview: row.overview || null,
      overview_lang: row.overview ? row.overview_lang || null : null, // 'de' = German fallback, null = English
      trailer: row.trailer_key ? {
        key: row.trailer_key,
        kinocheck_url: row.kinocheck_url || null,
        published_at: row.trailer_published_at || null
      } : null,
      genres: tagStatement.all(row.media_type, row.tmdb_id, 'genre'),
      keywords: tagStatement.all(row.media_type, row.tmdb_id, 'keyword'),
      providers: tagStatement.all(row.media_type, row.tmdb_id, 'provider'),
      providers_expected: tagStatement.all(row.media_type, row.tmdb_id, 'provider_expected'), // premieres on it, not streaming there yet
      decisions: decisionStatement.all(row.media_type, row.tmdb_id).map(function (decision) {
        return {
          key: decision.key,
          source: decision.source,
          playable: Boolean(decision.playable),
          reason: decision.reason
        };
      })
    };
  });
}

// Per title: does any playable candidate come from TMDB, from KinoCheck? (ADR OS-D-51H34 asks for this split.)
function getReport() {
  return db.prepare([
    'SELECT original_language, COUNT(*) AS titles,',
    'SUM(tm OR kc) AS with_playable_trailer,',
    'SUM(tm AND NOT kc) AS playable_from_tmdb_only,',
    'SUM(kc AND NOT tm) AS playable_from_kinocheck_only,',
    'SUM(tm AND kc) AS playable_from_both',
    'FROM (SELECT t.original_language,',
    "  EXISTS (SELECT 1 FROM candidates c WHERE c.media_type = t.media_type AND c.tmdb_id = t.tmdb_id AND c.playable = 1 AND c.source IN ('tmdb','both')) AS tm,",
    "  EXISTS (SELECT 1 FROM candidates c WHERE c.media_type = t.media_type AND c.tmdb_id = t.tmdb_id AND c.playable = 1 AND c.source IN ('kinocheck','both')) AS kc",
    '  FROM titles t)',
    'GROUP BY original_language ORDER BY original_language'
  ].join(' ')).all();
}

// Seerr state of every title; cached for a minute so page loads don't hammer Seerr.
async function getSeerrStatuses() {
  if (seerrCache.value && Date.now() - seerrCache.at < 60000) return seerrCache.value;
  var value = await seerr.mediaStatuses(db.prepare('SELECT media_type, tmdb_id FROM titles').all());
  seerrCache = { at: Date.now(), value: value };
  return value;
}

// Writes only from our own page or the TV app (file origin), so another website can't make the
// browser file requests. nginx forwards the original Host.
function trustedOrigin(req) {
  var origin = req.headers.origin;
  return !origin || origin === 'null' || origin === 'file://' || origin === 'http://' + req.headers.host;
}

// <prefix>/movie/603 or <prefix>/tv/1396; a bare <prefix>/603 is a movie (clients from before series existed).
function titleRef(pathname, prefix) {
  var match = pathname.startsWith(prefix + '/') && pathname.slice(prefix.length).match(/^\/(?:(movie|tv)\/)?(\d+)$/);
  return match ? { mediaType: match[1] || 'movie', tmdbId: Number(match[2]) } : null;
}

http.createServer(function (req, res) {
  var pathname = req.url.split('?')[0];
  if (req.method === 'GET' && pathname === '/api/health') {
    sendJson(res, 200, { status: 'ok', bootCount: boots, startedAt: started });
  } else if (req.method === 'GET' && pathname === '/api/titles') {
    sendJson(res, 200, getTitles());
  } else if (req.method === 'GET' && pathname === '/api/report') {
    sendJson(res, 200, getReport());
  } else if (req.method === 'GET' && pathname === '/api/seerr') {
    getSeerrStatuses().then(function (value) { sendJson(res, 200, value); })
      .catch(function (error) { sendJson(res, 502, { error: error.message }); });
  } else if (req.method === 'POST' && titleRef(pathname, '/api/request')) {
    var ref = titleRef(pathname, '/api/request');
    if (!trustedOrigin(req)) return sendJson(res, 403, { error: 'foreign origin' });
    if (!db.prepare('SELECT 1 FROM titles WHERE media_type = ? AND tmdb_id = ?').get(ref.mediaType, ref.tmdbId)) return sendJson(res, 404, { error: 'unknown title' });
    seerr.requestMedia(ref.mediaType, ref.tmdbId).then(function (status) {
      seerrCache.value = null;
      console.log('seerr request ' + ref.mediaType + ' ' + ref.tmdbId + ' -> ' + status);
      sendJson(res, 200, { status: status });
    }).catch(function (error) { sendJson(res, 502, { error: error.message }); });
  } else if (req.method === 'GET' && titleRef(pathname, '/api/stream')) {
    // TV app: the title's trailer as a cached MP4 (downloads on first request, falls back past dead videos).
    var streamRef = titleRef(pathname, '/api/stream');
    media.ensureTitleTrailer(db, streamRef.mediaType, streamRef.tmdbId).then(function (key) {
      if (key) sendJson(res, 200, { key: key, url: media.mediaUrl(key) });
      else sendJson(res, 404, { error: 'no playable trailer' });
    }).catch(function (error) {
      sendJson(res, 502, { error: error.message });
    });
  } else {
    sendJson(res, 404, { error: 'not found' });
  }
}).listen(3000, '0.0.0.0', function () {
  console.log('reelradar backend on :3000, boot #' + boots);
  // Daily import (IMPORT_TIME, default 04:00 container time), then cache the trailers it picked.
  var runImportJob = scheduler.daily(process.env.IMPORT_TIME || '04:00', function () {
    return media.working(async function () {
      var result = await importer.runImport({ dbPath: dbPath });
      console.log('import ' + result.importId + ' stored ' + result.titles + ' titles');
      seerrCache.value = null;
      var cached = await media.prefetchAll(db);
      console.log('prefetch: ' + cached.ready + ' of ' + cached.titles + ' titles have a cached trailer');
    }).then(reprocess);
  }, console);
  // Low-priority, one-at-a-time HEVC pass over trailers cached before transcoding existed.
  function reprocess() {
    return media.reprocessCached(db, { logger: console }).then(function (done) {
      console.log('reprocess: ' + done.replaced + ' trailers transcoded, ' + done.kept + ' kept as they were');
    }).catch(function (error) { console.error('reprocess failed: ' + error.message); });
  }
  reprocess();
  if (process.env.IMPORT_ON_START === '1') runImportJob();
});
