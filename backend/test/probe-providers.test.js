'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var DatabaseSync = require('node:sqlite').DatabaseSync;
var importer = require('../import');
var probe = require('../probe-providers').probe;

test('probe writes one line per title in the window and never the token', async function () {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-'));
  var dbPath = path.join(dir, 'db.sqlite');
  var db = new DatabaseSync(dbPath);
  importer.ensureSchema(db);
  var add = db.prepare("INSERT INTO titles (media_type, tmdb_id, title, original_title, original_language, de_digital) VALUES ('movie', ?, ?, 'x', 'en', ?)");
  // run date 2026-11-23: window is 2026-11-20 .. 2026-12-07
  add.run(1, 'Edge Past', '2026-11-20');
  add.run(2, 'Too Old', '2026-11-19');
  add.run(3, 'Edge Future', '2026-12-07');
  add.run(4, 'Too Far', '2026-12-08');
  add.run(5, 'No Date', null);
  db.prepare("INSERT INTO title_tags (media_type, tmdb_id, kind, tag_id, name) VALUES ('movie', 3, 'provider_expected', 8, 'Netflix')").run();
  db.close();

  var urls = [];
  var auth = [];
  function fetchFn(url, options) {
    urls.push(url);
    auth.push(options.headers.Authorization);
    var de = url.indexOf('/movie/3/') !== -1
      ? { flatrate: [{ provider_name: 'Netflix' }], buy: [{}], ads: [] }
      : { rent: [{}] };
    return Promise.resolve({ ok: true, status: 200, json: function () {
      return Promise.resolve({ results: { DE: de, US: { flatrate: [{ provider_name: 'Hulu' }] } } });
    } });
  }
  var outPath = path.join(dir, 'probe.jsonl');
  var options = { dbPath: dbPath, outPath: outPath, fetch: fetchFn, sleep: function () { return Promise.resolve(); },
    now: new Date('2026-11-23T12:00:00Z'), env: { TMDB_API_KEY: 'secret-token' } };

  assert.equal(await probe(options), 2);
  assert.equal(await probe(options), 2); // appends: one line per title per run
  assert.deepEqual(urls.slice(0, 2), [
    'https://api.themoviedb.org/3/movie/1/watch/providers', 'https://api.themoviedb.org/3/movie/3/watch/providers']);
  assert.equal(auth[0], 'Bearer secret-token');

  var text = fs.readFileSync(outPath, 'utf8');
  assert.equal(text.indexOf('secret-token'), -1);
  var lines = text.trim().split('\n').map(JSON.parse);
  assert.equal(lines.length, 4);
  assert.deepEqual(lines[0], { run: '2026-11-23', media_type: 'movie', tmdb_id: 1, title: 'Edge Past', de_digital: '2026-11-20',
    flatrate: [], buy: false, rent: true, ads: false, expected: [] });
  assert.deepEqual(lines[1], { run: '2026-11-23', media_type: 'movie', tmdb_id: 3, title: 'Edge Future', de_digital: '2026-12-07',
    flatrate: ['Netflix'], buy: true, rent: false, ads: false, expected: ['Netflix'] });
});

test('probe needs the token and leaves no file when TMDB fails', async function () {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-'));
  var dbPath = path.join(dir, 'db.sqlite');
  var db = new DatabaseSync(dbPath);
  importer.ensureSchema(db);
  db.prepare("INSERT INTO titles (media_type, tmdb_id, title, original_title, original_language, de_digital) VALUES ('movie', 1, 'A', 'A', 'en', '2026-11-23')").run();
  db.close();
  var outPath = path.join(dir, 'probe.jsonl');
  var base = { dbPath: dbPath, outPath: outPath, now: new Date('2026-11-23T12:00:00Z') };
  await assert.rejects(probe(Object.assign({ env: {} }, base)), /TMDB_API_KEY/);
  await assert.rejects(probe(Object.assign({ env: { TMDB_API_KEY: 't' },
    fetch: function () { return Promise.resolve({ ok: false, status: 429 }); } }, base)), /HTTP 429/);
  assert.equal(fs.existsSync(outPath), false);
});
