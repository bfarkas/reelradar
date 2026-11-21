'use strict';

var http = require('http');
var fs = require('fs');
var path = require('path');
var DatabaseSync = require('node:sqlite').DatabaseSync;
var importer = require('./import');

var dbPath = process.env.DB_PATH || '/data/reelradar.db';
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
var db = new DatabaseSync(dbPath);
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
    'SELECT t.*, c.kinocheck_url FROM titles t',
    'LEFT JOIN candidates c ON c.tmdb_id = t.tmdb_id AND c.key = t.trailer_key',
    'ORDER BY t.de_theatrical IS NULL, t.de_theatrical, t.title'
  ].join(' ')).all();
  var decisionStatement = db.prepare([
    'SELECT key, source, playable, reason FROM candidates',
    'WHERE tmdb_id = ? ORDER BY key'
  ].join(' '));

  return rows.map(function (row) {
    return {
      tmdb_id: row.tmdb_id,
      title: row.title,
      original_title: row.original_title,
      original_language: row.original_language,
      de_theatrical: row.de_theatrical,
      de_digital: row.de_digital,
      trailer: row.trailer_key ? {
        key: row.trailer_key,
        kinocheck_url: row.kinocheck_url || null
      } : null,
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

function getReport() {
  return db.prepare([
    'SELECT t.original_language, COUNT(*) AS titles,',
    'SUM(CASE WHEN c.key IS NOT NULL THEN 1 ELSE 0 END) AS with_playable_trailer,',
    "SUM(CASE WHEN c.source = 'tmdb' THEN 1 ELSE 0 END) AS playable_from_tmdb_only,",
    "SUM(CASE WHEN c.source = 'kinocheck' THEN 1 ELSE 0 END) AS playable_from_kinocheck_only,",
    "SUM(CASE WHEN c.source = 'both' THEN 1 ELSE 0 END) AS playable_from_both",
    'FROM titles t LEFT JOIN candidates c',
    'ON c.tmdb_id = t.tmdb_id AND c.key = t.trailer_key',
    'GROUP BY t.original_language ORDER BY t.original_language'
  ].join(' ')).all();
}

http.createServer(function (req, res) {
  var pathname = req.url.split('?')[0];
  if (req.method === 'GET' && pathname === '/api/health') {
    sendJson(res, 200, { status: 'ok', bootCount: boots, startedAt: started });
  } else if (req.method === 'GET' && pathname === '/api/titles') {
    sendJson(res, 200, getTitles());
  } else if (req.method === 'GET' && pathname === '/api/report') {
    sendJson(res, 200, getReport());
  } else {
    sendJson(res, 404, { error: 'not found' });
  }
}).listen(3000, '0.0.0.0', function () {
  console.log('reelradar backend on :3000, boot #' + boots);
  if (process.env.IMPORT_ON_START === '1') {
    importer.runImport({ dbPath: dbPath }).then(function (result) {
      console.log('startup import ' + result.importId + ' stored ' + result.titles + ' titles');
    }).catch(function (error) {
      console.error('startup import failed: ' + error.message);
    });
  }
});
