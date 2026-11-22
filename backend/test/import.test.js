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

// A series that shares its id (101) with the fixture movie: TMDB numbers movies and series separately.
var seriesDetail = {
  id: 101, name: 'Fixture Series', original_name: 'Fixture Serie', original_language: 'de',
  genres: [{ id: 18, name: 'Drama' }, { id: 10765, name: 'Sci-Fi & Fantasy' }],
  keywords: { results: [{ id: 1, name: 'dystopia' }] }, // /tv names the keyword list "results", /movie "keywords"
  poster_path: '/series-poster.jpg', backdrop_path: '/series-backdrop.jpg', overview: 'A series.',
  first_air_date: '2026-12-01', // origin date: never shown as a German date
  'watch/providers': { results: {
    DE: { flatrate: [{ provider_id: 8, provider_name: 'Netflix' }] },
    US: { flatrate: [{ provider_id: 9, provider_name: 'Prime Video' }] }
  } }
};
var seriesVideos = { results: [{ key: 'seriesVid01', iso_639_1: 'de', type: 'Trailer', site: 'YouTube', name: 'Official Trailer' }] };

function successfulFetch(url) {
  if (url.indexOf('/discover/tv') !== -1) return response(200, { results: [{ id: 101 }], total_pages: 1 });
  if (url.indexOf('/tv/101/videos') !== -1) return response(200, seriesVideos);
  if (url.indexOf('/tv/101?') !== -1) return response(200, seriesDetail);
  if (url.indexOf('api.kinocheck.com/shows?tmdb_id=101') !== -1) return response(404, {});
  if (url.indexOf('/discover/movie') !== -1) return response(200, fixture.discover);
  if (url.indexOf('/movie/101/release_dates') !== -1) return response(200, fixture.release_dates);
  if (url.indexOf('/movie/101/videos') !== -1) return response(200, fixture.videos);
  if (url.indexOf('api.kinocheck.com/trailers/latest') !== -1) {
    return response(200, { 0: { resource: { type: 'movie', tmdb_id: 101 } }, 1: { resource: { type: 'show', tmdb_id: 101 } } });
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
  var titlesBefore = db.prepare('SELECT * FROM titles ORDER BY media_type, tmdb_id').all();
  var candidatesBefore = db.prepare('SELECT * FROM candidates ORDER BY media_type, tmdb_id, key').all();
  var tagsBefore = db.prepare('SELECT media_type, kind, tag_id, name FROM title_tags ORDER BY media_type, kind, tag_id').all();
  assert.deepEqual(tagsBefore.map(function (row) { return row.media_type + ':' + row.kind + ':' + row.name; }), [
    'movie:genre:Drama', 'movie:keyword:based on novel', 'movie:keyword:superhero', 'movie:provider:Netflix',
    'tv:genre:Drama', 'tv:genre:Sci-Fi & Fantasy', 'tv:keyword:dystopia', 'tv:provider:Netflix'
  ]);
  assert.equal(titlesBefore.length, 2); // movie 101 and series 101 are both stored
  assert.equal(titlesBefore[0].media_type, 'movie');
  assert.equal(titlesBefore[0].trailer_key, 'fixture-video');
  assert.equal(titlesBefore[0].poster_path, '/poster.jpg');
  assert.equal(candidatesBefore[0].source, 'both');
  assert.match(calls[0].options.headers.Authorization, /^Bearer fixture-token$/);
  assert.ok(calls.some(function (call) {
    return call.url.indexOf('/movie/101/videos?include_video_language=en%2Cen%2Cde%2Cnull') !== -1;
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
  assert.deepEqual(db.prepare('SELECT * FROM titles ORDER BY media_type, tmdb_id').all(), titlesBefore);
  assert.deepEqual(db.prepare('SELECT * FROM candidates ORDER BY media_type, tmdb_id, key').all(), candidatesBefore);
  assert.deepEqual(db.prepare('SELECT media_type, kind, tag_id, name FROM title_tags ORDER BY media_type, kind, tag_id').all(), tagsBefore);
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
  var row = db.prepare("SELECT overview, overview_lang FROM titles WHERE media_type = 'movie'").get();
  var tags = db.prepare("SELECT kind, tag_id AS id, name FROM title_tags WHERE media_type = 'movie' AND kind LIKE 'provider%' ORDER BY kind, tag_id").all()
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

test('latest trailers yield the ids of one resource type, once each', function () {
  var body = {
    0: { resource: { type: 'movie', tmdb_id: 7 } },
    1: { resource: { type: 'show', tmdb_id: 8 } },
    2: { resource: { type: 'movie', tmdb_id: 7 } },
    3: { title: 'no resource' }
  };
  assert.deepEqual(importer.latestTrailerIds(body), [7]);
  assert.deepEqual(importer.latestTrailerIds(body, 'movie'), [7]);
  assert.deepEqual(importer.latestTrailerIds(body, 'show'), [8]);
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

// ---- series (OS-T-J0NCM) ----
async function importAll(t, fetchFn, env) {
  var directory = fs.mkdtempSync(path.join(os.tmpdir(), 'reelradar-test-'));
  var dbPath = path.join(directory, 'reelradar.db');
  t.after(function () { fs.rmSync(directory, { recursive: true, force: true }); });
  var urls = [];
  await importer.runImport({
    dbPath: dbPath,
    fetch: function (url) { urls.push(url); return fetchFn(url); },
    sleep: function () { return Promise.resolve(); },
    now: new Date('2026-11-21T12:00:00Z'),
    env: Object.assign({ TMDB_API_KEY: 'fixture-token' }, env),
    logger: { log: function () {}, warn: function () {} }
  });
  var db = new DatabaseSync(dbPath);
  t.after(function () { db.close(); });
  return { db: db, urls: urls };
}

test('a series is stored next to the movie with the same id, with no German dates and its own tags and trailer', async function (t) {
  var run = await importAll(t, successfulFetch);
  var rows = run.db.prepare('SELECT media_type, tmdb_id, title, original_title, original_language, de_theatrical, de_digital, trailer_key, poster_path FROM titles ORDER BY media_type').all()
    .map(function (row) { return Object.assign({}, row); });
  assert.deepEqual(rows, [
    { media_type: 'movie', tmdb_id: 101, title: 'Fixture Film', original_title: 'Fixture Film', original_language: 'en', de_theatrical: '2026-12-10', de_digital: '2027-01-15', trailer_key: 'fixture-video', poster_path: '/poster.jpg' },
    { media_type: 'tv', tmdb_id: 101, title: 'Fixture Series', original_title: 'Fixture Serie', original_language: 'de', de_theatrical: null, de_digital: null, trailer_key: 'seriesVid01', poster_path: '/series-poster.jpg' }
  ]);
  var candidates = run.db.prepare('SELECT media_type, key, playable FROM candidates ORDER BY media_type').all().map(function (row) { return Object.assign({}, row); });
  assert.deepEqual(candidates, [
    { media_type: 'movie', key: 'fixture-video', playable: 1 },
    { media_type: 'tv', key: 'seriesVid01', playable: 1 }
  ]);
  // German flatrate only: the US provider and the origin first_air_date never become a service or a date
  var providers = run.db.prepare("SELECT name FROM title_tags WHERE media_type = 'tv' AND kind = 'provider'").all().map(function (row) { return row.name; });
  assert.deepEqual(providers, ['Netflix']);
  assert.ok(run.urls.some(function (url) { return /discover\/tv\?.*watch_region=DE.*with_watch_monetization_types=flatrate.*first_air_date\.gte=2026-10-22/.test(url); }));
  assert.ok(run.urls.some(function (url) { return /discover\/tv\?(?!.*watch_region)/.test(url); }));
  assert.ok(run.urls.some(function (url) { return url.indexOf('/tv/101?language=en-US&append_to_response=keywords,watch/providers,translations') !== -1; }));
  assert.ok(run.urls.some(function (url) { return url.indexOf('/tv/101/videos?include_video_language=de%2Cen%2Cde%2Cnull') !== -1; }));
  assert.ok(run.urls.some(function (url) { return url === 'https://api.kinocheck.com/shows?tmdb_id=101&language=de'; })); // German original: de bucket
  assert.ok(!run.urls.some(function (url) { return url.indexOf('/tv/101/release_dates') !== -1; }));
});

test('a series without German streaming data stores no service and no date', async function (t) {
  var run = await importAll(t, function (url) {
    if (url.indexOf('/tv/101?') !== -1) {
      return response(200, Object.assign({}, seriesDetail, { 'watch/providers': { results: { US: { flatrate: [{ provider_id: 9, provider_name: 'Prime Video' }] } } } }));
    }
    return successfulFetch(url);
  });
  assert.equal(run.db.prepare("SELECT COUNT(*) AS n FROM title_tags WHERE media_type = 'tv' AND kind LIKE 'provider%'").get().n, 0);
  var row = run.db.prepare("SELECT de_theatrical, de_digital FROM titles WHERE media_type = 'tv'").get();
  assert.deepEqual(Object.assign({}, row), { de_theatrical: null, de_digital: null });
});

test('extra series ids are imported as series', async function (t) {
  var run = await importAll(t, function (url) {
    if (url.indexOf('/discover/tv') !== -1) return response(200, { results: [] });
    if (/\/tv\/777\//.test(url)) return response(200, seriesVideos);
    if (/\/tv\/777\?/.test(url)) return response(200, Object.assign({}, seriesDetail, { id: 777, name: 'Extra Series' }));
    if (url.indexOf('api.kinocheck.com/trailers/latest') !== -1) return response(200, { 0: { resource: { type: 'movie', tmdb_id: 101 } } });
    if (url.indexOf('api.kinocheck.com/shows') !== -1) return response(404, {});
    return successfulFetch(url);
  }, { IMPORT_EXTRA_TV_IDS: '777' });
  var rows = run.db.prepare('SELECT media_type, tmdb_id FROM titles ORDER BY media_type, tmdb_id').all().map(function (row) { return row.media_type + ':' + row.tmdb_id; });
  assert.deepEqual(rows, ['movie:101', 'tv:777']);
});

test('a database from before series migrates: rows become movies, nothing is lost, a series may reuse an id', function () {
  var db = new DatabaseSync(':memory:');
  db.exec([
    'CREATE TABLE titles (tmdb_id INTEGER PRIMARY KEY, title TEXT NOT NULL, original_title TEXT NOT NULL, original_language TEXT NOT NULL,',
    'de_theatrical TEXT, de_digital TEXT, trailer_key TEXT, poster_path TEXT, backdrop_path TEXT, overview TEXT, overview_lang TEXT)',
    ';CREATE TABLE candidates (tmdb_id INTEGER NOT NULL, key TEXT NOT NULL, source TEXT NOT NULL, tmdb_lang TEXT, kc_lang TEXT, type TEXT,',
    'site TEXT, name TEXT, published_at TEXT, official INTEGER, kinocheck_url TEXT, playable INTEGER NOT NULL, reason TEXT NOT NULL, PRIMARY KEY (tmdb_id, key))',
    ';CREATE TABLE title_tags (tmdb_id INTEGER NOT NULL, kind TEXT NOT NULL, tag_id INTEGER NOT NULL, name TEXT NOT NULL, PRIMARY KEY (tmdb_id, kind, tag_id))',
    ';CREATE TABLE imports (id INTEGER PRIMARY KEY AUTOINCREMENT, started TEXT NOT NULL, finished TEXT, status TEXT NOT NULL, error TEXT)',
    ";INSERT INTO titles VALUES (603, 'The Matrix', 'The Matrix', 'en', '2026-12-01', NULL, 'abcdefghijk', '/p.jpg', '/b.jpg', 'Text.', 'de')",
    ";INSERT INTO candidates VALUES (603, 'abcdefghijk', 'tmdb', 'en', NULL, 'Trailer', 'YouTube', 'Trailer', '2026-01-01', 1, NULL, 1, 'ok')",
    ";INSERT INTO title_tags VALUES (603, 'genre', 28, 'Action')",
    ";INSERT INTO imports (started, status) VALUES ('2026-11-20T04:00:00Z', 'success')"
  ].join(' '));
  importer.ensureSchema(db);
  importer.ensureSchema(db); // idempotent
  var title = db.prepare('SELECT * FROM titles').get();
  assert.deepEqual(Object.assign({}, title), { media_type: 'movie', tmdb_id: 603, title: 'The Matrix', original_title: 'The Matrix', original_language: 'en',
    de_theatrical: '2026-12-01', de_digital: null, trailer_key: 'abcdefghijk', poster_path: '/p.jpg', backdrop_path: '/b.jpg', overview: 'Text.', overview_lang: 'de' });
  assert.equal(db.prepare("SELECT media_type FROM candidates WHERE tmdb_id = 603 AND key = 'abcdefghijk'").get().media_type, 'movie');
  assert.deepEqual(Object.assign({}, db.prepare('SELECT media_type, kind, name FROM title_tags').get()), { media_type: 'movie', kind: 'genre', name: 'Action' });
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM imports').get().n, 1);
  db.exec("INSERT INTO titles (media_type, tmdb_id, title, original_title, original_language) VALUES ('tv', 603, 'A Series', 'A Series', 'en')");
  db.exec("INSERT INTO candidates (media_type, tmdb_id, key, source, playable, reason) VALUES ('tv', 603, 'abcdefghijk', 'tmdb', 1, 'ok')");
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM titles WHERE tmdb_id = 603').get().n, 2);
  assert.throws(function () { db.exec("INSERT INTO titles (media_type, tmdb_id, title, original_title, original_language) VALUES ('tv', 603, 'x', 'x', 'en')"); });
  db.close();
});
