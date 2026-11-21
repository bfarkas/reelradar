// Minimal backend: /api/health + SQLite boot counter (node:sqlite, built into Node 24).
var http = require('http');
var fs = require('fs');
var path = require('path');
var DatabaseSync = require('node:sqlite').DatabaseSync;

var dbPath = process.env.DB_PATH || '/data/reelradar.db';
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
var db = new DatabaseSync(dbPath);
db.exec('CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL)');
db.exec("INSERT INTO meta (key, value) VALUES ('boot_count', 1) " +
  'ON CONFLICT(key) DO UPDATE SET value = value + 1');
var boots = db.prepare("SELECT value FROM meta WHERE key = 'boot_count'").get().value;
var started = new Date().toISOString();

http.createServer(function (req, res) {
  if (req.url.split('?')[0] === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ status: 'ok', bootCount: boots, startedAt: started }));
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end('{"error":"not found"}');
  }
}).listen(3000, '0.0.0.0', function () { console.log('reelradar backend on :3000, boot #' + boots); });
