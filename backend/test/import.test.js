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
  if (url.indexOf('api.kinocheck.com/trailers/latest') !== -1) {
    return response(200, { 0: { resource: { type: 'movie', tmdb_id: 101 } }, 1: { resource: { type: 'show', tmdb_id: 93405 } } });
  }
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
    env: { TMDB_API_KEY: 'fixture-token' },
    logger: { log: function () {}, warn: function () {} }
  });

  var db = new DatabaseSync(dbPath);
  var titlesBefore = db.prepare('SELECT * FROM titles ORDER BY tmdb_id').all();
  var candidatesBefore = db.prepare('SELECT * FROM candidates ORDER BY tmdb_id, key').all();
  var tagsBefore = db.prepare('SELECT kind, tag_id, name FROM title_tags ORDER BY kind, tag_id').all();
  assert.deepEqual(tagsBefore.map(function (row) { return row.kind + ':' + row.name; }),
    ['genre:Drama', 'keyword:based on novel', 'keyword:superhero', 'provider:Netflix']);
  assert.equal(titlesBefore.length, 1);
  assert.equal(titlesBefore[0].trailer_key, 'fixture-video');
  assert.equal(titlesBefore[0].poster_path, '/poster.jpg');
  assert.equal(candidatesBefore[0].source, 'both');
  assert.match(calls[0].options.headers.Authorization, /^Bearer fixture-token$/);
  assert.ok(calls.some(function (call) {
    return call.url.indexOf('/videos?include_video_language=en%2Cen%2Cde%2Cnull') !== -1;
  }));
  assert.ok(calls.some(function (call) {
    return call.url === 'https://api.kinocheck.com/movies?tmdb_id=101&language=en';
  }));
  assert.ok(calls.some(function (call) {
    return /discover\/movie\?.*with_release_type=3%7C4%7C6.*release_date\.lte=2027-05-23.*page=1/.test(call.url);
  }));
  assert.ok(calls.some(function (call) { return call.url.indexOf('/trailers/latest') !== -1; }));
  db.close();

  await assert.rejects(importer.runImport({
    dbPath: dbPath,
    fetch: function () { return response(500, { error: 'fixture failure' }); },
    sleep: function () { return Promise.resolve(); },
    now: new Date('2026-11-21T12:00:00Z'),
    env: { TMDB_API_KEY: 'fixture-token' },
    logger: { log: function () {}, warn: function () {} }
  }), /TMDB returned HTTP 500/);

  db = new DatabaseSync(dbPath);
  assert.deepEqual(db.prepare('SELECT * FROM titles ORDER BY tmdb_id').all(), titlesBefore);
  assert.deepEqual(db.prepare('SELECT * FROM candidates ORDER BY tmdb_id, key').all(), candidatesBefore);
  assert.deepEqual(db.prepare('SELECT kind, tag_id, name FROM title_tags ORDER BY kind, tag_id').all(), tagsBefore);
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

// Runs one import against a detail response and returns the stored row plus the requested URLs.
async function importWith(t, detail, releaseDates) {
  var directory = fs.mkdtempSync(path.join(os.tmpdir(), 'reelradar-test-'));
  var dbPath = path.join(directory, 'reelradar.db');
  t.after(function () { fs.rmSync(directory, { recursive: true, force: true }); });
  var urls = [];
  await importer.runImport({
    dbPath: dbPath,
    fetch: function (url) {
      urls.push(url);
      if (releaseDates && url.indexOf('/movie/101/release_dates') !== -1) return response(200, releaseDates);
      return url.indexOf('/movie/101?') !== -1 ? response(200, detail) : successfulFetch(url);
    },
    sleep: function () { return Promise.resolve(); },
    now: new Date('2026-11-21T12:00:00Z'),
    env: { TMDB_API_KEY: 'fixture-token' },
    logger: { log: function () {}, warn: function () {} }
  });
  var db = new DatabaseSync(dbPath);
  var row = db.prepare('SELECT overview, overview_lang FROM titles').get();
  var tags = db.prepare("SELECT kind, tag_id AS id, name FROM title_tags WHERE kind LIKE 'provider%' ORDER BY kind, tag_id").all()
    .map(function (tag) { return Object.assign({}, tag); });
  db.close();
  return { row: row, urls: urls, tags: tags };
}

function withTranslation(overview, deOverview) {
  return Object.assign({}, fixture.detail, {
    overview: overview,
    translations: { translations: [
      { iso_639_1: 'fr', data: { overview: 'Un film.' } },
      { iso_639_1: 'de', data: { overview: deOverview } }
    ] }
  });
}

test('English synopsis is kept, German translation ignored', async function (t) {
  var result = await importWith(t, withTranslation('English text.', 'Deutscher Text.'));
  assert.equal(result.row.overview, 'English text.');
  assert.equal(result.row.overview_lang, null);
  var details = result.urls.filter(function (url) { return /\/movie\/101\?/.test(url); });
  assert.equal(details.length, 1); // no extra request per title
  assert.match(details[0], /append_to_response=keywords,watch\/providers,translations/);
});

test('empty English synopsis falls back to the German one, marked de', async function (t) {
  var result = await importWith(t, withTranslation('', 'Deutscher Text.'));
  assert.equal(result.row.overview, 'Deutscher Text.');
  assert.equal(result.row.overview_lang, 'de');
});

test('no English and no German synopsis stays empty', async function (t) {
  var result = await importWith(t, withTranslation('', ''));
  assert.equal(result.row.overview, null);
  assert.equal(result.row.overview_lang, null);
  result = await importWith(t, Object.assign({}, fixture.detail, { overview: '' })); // translations missing altogether
  assert.equal(result.row.overview, null);
  assert.equal(result.row.overview_lang, null);
});

test('ensureSchema adds overview_lang to an existing database and keeps its rows', function () {
  var db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE titles (tmdb_id INTEGER PRIMARY KEY, title TEXT NOT NULL, original_title TEXT NOT NULL, ' +
    'original_language TEXT NOT NULL, de_theatrical TEXT, de_digital TEXT, trailer_key TEXT, ' +
    'poster_path TEXT, backdrop_path TEXT, overview TEXT)');
  db.exec("INSERT INTO titles (tmdb_id, title, original_title, original_language, overview) VALUES (1, 'Old', 'Old', 'en', 'Kept.')");
  importer.ensureSchema(db);
  importer.ensureSchema(db); // idempotent
  assert.deepEqual(Object.assign({}, db.prepare('SELECT overview, overview_lang FROM titles').get()), { overview: 'Kept.', overview_lang: null });
  db.close();
});

test('latest trailers yield movie ids only, once each', function () {
  assert.deepEqual(importer.latestTrailerIds({
    0: { resource: { type: 'movie', tmdb_id: 7 } },
    1: { resource: { type: 'show', tmdb_id: 8 } },
    2: { resource: { type: 'movie', tmdb_id: 7 } },
    3: { title: 'no resource' }
  }), [7]);
});

// ---- expected provider: 'premieres on X' before TMDB lists a flatrate provider (OS-T-3HXMY) ----
var TODAY = '2026-11-21';
function digital(date, note, type) {
  return { results: [{ iso_3166_1: 'DE', release_dates: [{ type: type || 4, release_date: date + 'T00:00:00.000Z', note: note }] }] };
}
function detailWith(companies, flatrate) {
  return {
    production_companies: (companies || []).map(function (name) { return { name: name }; }),
    'watch/providers': { results: { DE: { flatrate: flatrate || [] } } }
  };
}

test('a digital note that names a service gives the expected provider', function () {
  var expected = importer.expectedProviders(digital('2026-12-04', 'Netflix'), detailWith(['Good One']), '2026-12-04', TODAY, []);
  assert.deepEqual(expected, [{ id: 8, name: 'Netflix' }]);
  ['Prime Video', ' disney+ ', 'Apple TV'].forEach(function (note) {
    assert.equal(importer.expectedProviders(digital('2026-12-04', note), detailWith(), '2026-12-04', TODAY, []).length, 1, note);
  });
});

test('no note, a note that names no service, or several services stays unknown', function () {
  ['', undefined, 'Arte.tv', 'Only on Baker+', 'Netflix and chill', '4K Ultra HD / Blu-ray / DVD'].forEach(function (note) {
    assert.deepEqual(importer.expectedProviders(digital('2026-12-04', note), detailWith(), '2026-12-04', TODAY, []), [], String(note));
  });
  var two = digital('2026-12-04', 'Netflix');
  two.results[0].release_dates.push({ type: 4, release_date: '2026-12-04T00:00:00.000Z', note: 'Prime Video' });
  assert.deepEqual(importer.expectedProviders(two, detailWith(), '2026-12-04', TODAY, []), []);
  // a note on a TV or physical entry, or on another date than the German digital date, is not used
  assert.deepEqual(importer.expectedProviders(digital('2026-12-04', 'Netflix', 6), detailWith(), '2026-12-04', TODAY, []), []);
  assert.deepEqual(importer.expectedProviders(digital('2026-12-04', 'Netflix'), detailWith(), '2026-12-18', TODAY, []), []);
});

test('production companies decide only against the note: another service vetoes, no match or the same one passes', function () {
  var notes = digital('2026-11-23', 'Netflix'); // Clashing Through the Snow: note says Netflix, studio is Amazon MGM Studios
  assert.deepEqual(importer.expectedProviders(notes, detailWith(['Amazon MGM Studios', 'Wonderland Sound and Vision']), '2026-11-23', TODAY, []), []);
  assert.equal(importer.expectedProviders(notes, detailWith(['Netflix Animation Studios']), '2026-11-23', TODAY, []).length, 1);
  assert.equal(importer.expectedProviders(notes, detailWith(['Tyler Perry Studios']), '2026-11-23', TODAY, []).length, 1);
  // a studio alone never names a service
  assert.deepEqual(importer.expectedProviders(digital('2026-11-23', ''), detailWith(['Netflix']), '2026-11-23', TODAY, []), []);
});

test('a past digital date, or a service the title already streams on, gives no expected provider', function () {
  assert.deepEqual(importer.expectedProviders(digital('2026-11-01', 'Netflix'), detailWith(), '2026-11-01', TODAY, []), []);
  assert.deepEqual(importer.expectedProviders(digital('2026-12-04', 'Netflix'), detailWith(), '2026-12-04', TODAY, [{ id: 8, name: 'Netflix' }]), []);
  assert.deepEqual(importer.expectedProviders(digital('2026-12-04', 'Netflix'), detailWith(), null, TODAY, []), []);
});

test('the import stores the expected provider as its own tag kind, and drops it once the flatrate entry appears', async function (t) {
  var releaseDates = digital('2027-01-15', 'Disney+');
  var before = await importWith(t, Object.assign({}, fixture.detail, detailWith(['Walt Disney Pictures'])), releaseDates);
  assert.deepEqual(before.tags, [{ kind: 'provider_expected', id: 337, name: 'Disney Plus' }]);
  var after = await importWith(t, Object.assign({}, fixture.detail, detailWith([], [{ provider_id: 337, provider_name: 'Disney Plus' }])), releaseDates);
  assert.deepEqual(after.tags, [{ kind: 'provider', id: 337, name: 'Disney Plus' }]);
  var none = await importWith(t, fixture.detail, fixture.release_dates); // fixture: note missing, and Netflix already streams
  assert.deepEqual(none.tags, [{ kind: 'provider', id: 8, name: 'Netflix' }]);
});
