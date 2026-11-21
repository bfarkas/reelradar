'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var DatabaseSync = require('node:sqlite').DatabaseSync;
var importer = require('../import');

var fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'import-success.json')));

function response(status, body) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status: status,
    text: function () { return Promise.resolve(JSON.stringify(body)); },
    json: function () { return Promise.resolve(body); }
  });
}

function successfulFetch(url) {
  if (url.indexOf('/discover/movie') !== -1) return response(200, fixture.discover);
  if (url.indexOf('/movie/101/release_dates') !== -1) return response(200, fixture.release_dates);
  if (url.indexOf('/movie/101/videos') !== -1) return response(200, fixture.videos);
  if (url.indexOf('api.kinocheck.com/movies') !== -1) return response(200, fixture.kinocheck);
  if (url.indexOf('/movie/101?') !== -1) return response(200, fixture.detail);
  return response(404, {});
}

test('German dates never fall back to another country', function () {
  var dates = importer.germanDates({
    results: [{
      iso_3166_1: 'US',
      release_dates: [{ type: 3, release_date: '2026-12-10T00:00:00Z' }]
    }]
  }, '2026-11-21');
  assert.deepEqual(dates, { theatrical: null, digital: null });
});

test('German dates choose earliest future date, or latest past date', function () {
  var dates = importer.germanDates({
    results: [{
      iso_3166_1: 'DE',
      release_dates: [
        { type: 3, release_date: '2026-11-01T00:00:00Z' },
        { type: 3, release_date: '2026-12-20T00:00:00Z' },
        { type: 3, release_date: '2026-12-10T00:00:00Z' },
        { type: 4, release_date: '2026-10-01T00:00:00Z' },
        { type: 4, release_date: '2026-11-01T00:00:00Z' }
      ]
    }]
  }, '2026-11-21');
  assert.deepEqual(dates, { theatrical: '2026-12-10', digital: '2026-11-01' });
});

test('failed import preserves titles and candidates and records failure', async function (t) {
  var directory = fs.mkdtempSync(path.join(os.tmpdir(), 'reelradar-test-'));
  var dbPath = path.join(directory, 'reelradar.db');
  t.after(function () { fs.rmSync(directory, { recursive: true, force: true }); });

  var calls = [];
  await importer.runImport({
    dbPath: dbPath,
    fetch: function (url, options) {
      calls.push({ url: url, options: options });
      return successfulFetch(url);
    },
    sleep: function () { return Promise.resolve(); },
    now: new Date('2026-11-21T12:00:00Z'),
    env: { TMDB_API_KEY: 'fixture-token', IMPORT_LIMIT: '1' },
    logger: { log: function () {}, warn: function () {} }
  });

  var db = new DatabaseSync(dbPath);
  var titlesBefore = db.prepare('SELECT * FROM titles ORDER BY tmdb_id').all();
  var candidatesBefore = db.prepare('SELECT * FROM candidates ORDER BY tmdb_id, key').all();
  assert.equal(titlesBefore.length, 1);
  assert.equal(titlesBefore[0].trailer_key, 'fixture-video');
  assert.equal(candidatesBefore[0].source, 'both');
  assert.match(calls[0].options.headers.Authorization, /^Bearer fixture-token$/);
  assert.ok(calls.some(function (call) {
    return call.url.indexOf('/videos?include_video_language=en%2Cen%2Cde%2Cnull') !== -1;
  }));
  assert.ok(calls.some(function (call) {
    return call.url === 'https://api.kinocheck.com/movies?tmdb_id=101&language=en';
  }));
  db.close();

  await assert.rejects(importer.runImport({
    dbPath: dbPath,
    fetch: function () { return response(500, { error: 'fixture failure' }); },
    sleep: function () { return Promise.resolve(); },
    now: new Date('2026-11-21T12:00:00Z'),
    env: { TMDB_API_KEY: 'fixture-token', IMPORT_LIMIT: '1' },
    logger: { log: function () {}, warn: function () {} }
  }), /TMDB returned HTTP 500/);

  db = new DatabaseSync(dbPath);
  assert.deepEqual(db.prepare('SELECT * FROM titles ORDER BY tmdb_id').all(), titlesBefore);
  assert.deepEqual(db.prepare('SELECT * FROM candidates ORDER BY tmdb_id, key').all(), candidatesBefore);
  var imports = db.prepare('SELECT status FROM imports ORDER BY id').all();
  assert.deepEqual(imports.map(function (row) { return row.status; }), ['success', 'failed']);
  db.close();
});

test('KinoCheck clips tagged Trailer are not treated as trailers', function () {
  var out = importer.kinoCheckCandidates({ language: 'en', videos: [
    { youtube_video_id: 'clip1', categories: ['Trailer', 'Clip'] },
    { youtube_video_id: 'tr1', categories: ['Trailer'] }
  ] });
  assert.deepEqual(out.map(function (c) { return [c.key, c.type]; }), [['clip1', 'Clip'], ['tr1', 'Trailer']]);
});
