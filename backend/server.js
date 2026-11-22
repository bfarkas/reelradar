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
    'LEFT JOIN candidates c ON c.tmdb_id = t.tmdb_id AND c.key = t.trailer_key',
    'ORDER BY t.de_theatrical IS NULL, t.de_theatrical, t.title'
  ].join(' ')).all();
  var decisionStatement = db.prepare([
    'SELECT key, source, playable, reason FROM candidates',
    'WHERE tmdb_id = ? ORDER BY key'
  ].join(' '));
  var tagStatement = db.prepare('SELECT tag_id AS id, name FROM title_tags WHERE tmdb_id = ? AND kind = ? ORDER BY name');

  return rows.map(function (row) {
    return {
      tmdb_id: row.tmdb_id,
      title: row.title,
      original_title: row.original_title,
      original_language: row.original_language,
      de_theatrical: row.de_theatrical,
      de_digital: row.de_digital,
      poster_path: row.poster_path || null,
      backdrop_path: row.backdrop_path || null,
      overview: row.overview || null,
      trailer: row.trailer_key ? {
        key: row.trailer_key,
        kinocheck_url: row.kinocheck_url || null,
        published_at: row.trailer_published_at || null
      } : null,
      genres: tagStatement.all(row.tmdb_id, 'genre'),
      keywords: tagStatement.all(row.tmdb_id, 'keyword'),
      providers: tagStatement.all(row.tmdb_id, 'provider'),
      decisions: decisionStatement.all(row.tmdb_id).map(function (decision) {
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
    "  EXISTS (SELECT 1 FROM candidates c WHERE c.tmdb_id = t.tmdb_id AND c.playable = 1 AND c.source IN ('tmdb','both')) AS tm,",
    "  EXISTS (SELECT 1 FROM candidates c WHERE c.tmdb_id = t.tmdb_id AND c.playable = 1 AND c.source IN ('kinocheck','both')) AS kc",
    '  FROM titles t)',
    'GROUP BY original_language ORDER BY original_language'
  ].join(' ')).all();
}

// Seerr state of every title; cached for a minute so page loads don't hammer Seerr.
async function getSeerrStatuses() {
  if (seerrCache.value && Date.now() - seerrCache.at < 60000) return seerrCache.value;
  var ids = db.prepare('SELECT tmdb_id FROM titles').all();
  var value = await seerr.movieStatuses(ids.map(function (row) { return row.tmdb_id; }));
  seerrCache = { at: Date.now(), value: value };
  return value;
}

// Writes only from our own page or the TV app (file origin), so another website can't make the
// browser file requests. nginx forwards the original Host.
function trustedOrigin(req) {
  var origin = req.headers.origin;
  return !origin || origin === 'null' || origin === 'file://' || origin === 'http://' + req.headers.host;
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
  } else if (req.method === 'POST' && /^\/api\/request\/\d+$/.test(pathname)) {
    var tmdbId = Number(pathname.split('/')[3]);
    if (!trustedOrigin(req)) return sendJson(res, 403, { error: 'foreign origin' });
    if (!db.prepare('SELECT 1 FROM titles WHERE tmdb_id = ?').get(tmdbId)) return sendJson(res, 404, { error: 'unknown title' });
    seerr.requestMovie(tmdbId).then(function (status) {
      seerrCache.value = null;
      console.log('seerr request ' + tmdbId + ' -> ' + status);
      sendJson(res, 200, { status: status });
    }).catch(function (error) { sendJson(res, 502, { error: error.message }); });
  } else if (req.method === 'GET' && /^\/api\/stream\/\d+$/.test(pathname)) {
    // TV app: the title's trailer as a cached MP4 (downloads on first request, falls back past dead videos).
    media.ensureTitleTrailer(db, Number(pathname.split('/')[3])).then(function (key) {
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
  var runImportJob = scheduler.daily(process.env.IMPORT_TIME || '04:00', async function () {
    var result = await importer.runImport({ dbPath: dbPath });
    console.log('import ' + result.importId + ' stored ' + result.titles + ' titles');
    seerrCache.value = null;
    var cached = await media.prefetchAll(db);
    console.log('prefetch: ' + cached.ready + ' of ' + cached.titles + ' titles have a cached trailer');
  }, console);
  if (process.env.IMPORT_ON_START === '1') runImportJob();
});
