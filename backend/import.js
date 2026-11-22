'use strict';

var fs = require('fs');
var path = require('path');
var DatabaseSync = require('node:sqlite').DatabaseSync;
var gate = require('./gate');

var TMDB_BASE = 'https://api.themoviedb.org/3';
var KINOCHECK_BASE = 'https://api.kinocheck.com';

function ensureSchema(db) {
  db.exec([
    'CREATE TABLE IF NOT EXISTS titles (',
    'tmdb_id INTEGER PRIMARY KEY, title TEXT NOT NULL, original_title TEXT NOT NULL,',
    'original_language TEXT NOT NULL, de_theatrical TEXT, de_digital TEXT, trailer_key TEXT)',
    ';CREATE TABLE IF NOT EXISTS candidates (',
    'tmdb_id INTEGER NOT NULL, key TEXT NOT NULL, source TEXT NOT NULL, tmdb_lang TEXT,',
    'kc_lang TEXT, type TEXT, site TEXT, name TEXT, published_at TEXT, official INTEGER,',
    'kinocheck_url TEXT, playable INTEGER NOT NULL, reason TEXT NOT NULL,',
    'PRIMARY KEY (tmdb_id, key))',
    ';CREATE TABLE IF NOT EXISTS imports (',
    'id INTEGER PRIMARY KEY AUTOINCREMENT, started TEXT NOT NULL, finished TEXT,',
    'status TEXT NOT NULL, error TEXT)',
    ';CREATE TABLE IF NOT EXISTS title_tags (',
    'tmdb_id INTEGER NOT NULL, kind TEXT NOT NULL, tag_id INTEGER NOT NULL, name TEXT NOT NULL,',
    'PRIMARY KEY (tmdb_id, kind, tag_id))'
  ].join(' '));
  // Columns added after the first release; ALTER on an existing database, no-op when present.
  var have = db.prepare('PRAGMA table_info(titles)').all().map(function (column) { return column.name; });
  ['poster_path', 'backdrop_path', 'overview'].forEach(function (column) {
    if (have.indexOf(column) === -1) db.exec('ALTER TABLE titles ADD COLUMN ' + column + ' TEXT');
  });
}

// German flatrate (subscription) services, e.g. Netflix; stored as 'provider' tags.
function germanProviders(detail) {
  var de = detail['watch/providers'] && detail['watch/providers'].results && detail['watch/providers'].results.DE;
  // Drop resold channels and plan variants ("... Amazon Channel", "Netflix Standard with Ads", "Netflix Kids").
  return ((de && de.flatrate) || []).filter(function (p) { return !/channel|with ads|kids/i.test(p.provider_name); })
    .map(function (p) { return { id: p.provider_id, name: p.provider_name.trim() }; });
}

function delay(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

function requestJson(fetchFn, url, options, provider, timeoutMs) {
  var controller = new AbortController();
  var timer = setTimeout(function () { controller.abort(); }, timeoutMs || 15000);
  var requestOptions = Object.assign({}, options, { signal: controller.signal });

  return fetchFn(url, requestOptions).then(function (response) {
    if (!response.ok) {
      var error = new Error(provider + ' returned HTTP ' + response.status + ' for ' + url);
      error.status = response.status;
      throw error;
    }
    if (response.status === 204) return null;
    if (typeof response.text === 'function') {
      return response.text().then(function (body) {
        return body ? JSON.parse(body) : null;
      });
    }
    return response.json();
  }).finally(function () { clearTimeout(timer); });
}

function dateOnly(value) {
  return typeof value === 'string' && value.length >= 10 ? value.slice(0, 10) : null;
}

function pickReleaseDate(entries, type, today) {
  var dates = (entries || []).filter(function (entry) {
    return entry.type === type && dateOnly(entry.release_date);
  }).map(function (entry) { return dateOnly(entry.release_date); }).sort();
  var future = dates.filter(function (value) { return value >= today; });
  return future.length ? future[0] : (dates.length ? dates[dates.length - 1] : null);
}

function germanDates(payload, today) {
  var germany = (payload.results || []).find(function (entry) {
    return entry.iso_3166_1 === 'DE';
  });
  var entries = germany ? germany.release_dates : [];
  return {
    theatrical: pickReleaseDate(entries, 3, today),
    digital: pickReleaseDate(entries, 4, today)
  };
}

function tmdbCandidates(payload) {
  return (payload.results || []).map(function (video) {
    return {
      key: video.key,
      source: 'tmdb',
      tmdb_lang: video.iso_639_1 || null,
      kc_lang: null,
      type: video.type || null,
      site: video.site || null,
      name: video.name || '',
      published_at: video.published_at || null,
      official: video.official === true,
      kinocheck_url: null
    };
  }).filter(function (candidate) { return candidate.key; });
}

function kinoCheckCandidates(payload) {
  if (!payload) return [];
  return (payload.videos || []).map(function (video) {
    var categories = video.categories || [];
    // KinoCheck tags clips and specials with "Trailer" too (seen live 2026-11-21), so any non-trailer category disqualifies.
    var other = categories.find(function (category) {
      return ['Clip', 'Special', 'Compilation', 'Talk', 'Original', 'Featurette'].indexOf(category) >= 0;
    });
    var accepted = other ? null : categories.find(function (category) {
      return category === 'Trailer' || category === 'Teaser' || category === 'Teaser Trailer';
    });
    return {
      key: video.youtube_video_id,
      source: 'kinocheck',
      tmdb_lang: null,
      kc_lang: video.language || payload.language || null,
      type: other || accepted || categories[0] || null,
      site: 'YouTube',
      name: video.title || '',
      published_at: video.published || null,
      official: false,
      kinocheck_url: video.url || null
    };
  }).filter(function (candidate) { return candidate.key; });
}

function mergeCandidates(tmdb, kinoCheck) {
  var merged = [];
  var byKey = Object.create(null);

  tmdb.concat(kinoCheck).forEach(function (candidate) {
    var existing = byKey[candidate.key];
    if (!existing) {
      existing = Object.assign({}, candidate);
      byKey[candidate.key] = existing;
      merged.push(existing);
      return;
    }
    existing.source = 'both';
    existing.tmdb_lang = existing.tmdb_lang || candidate.tmdb_lang;
    existing.kc_lang = existing.kc_lang || candidate.kc_lang;
    existing.kinocheck_url = existing.kinocheck_url || candidate.kinocheck_url;
    existing.published_at = existing.published_at || candidate.published_at;
    existing.official = existing.official || candidate.official;
    if ((existing.type !== 'Trailer' && existing.type !== 'Teaser' &&
         existing.type !== 'Teaser Trailer') &&
        (candidate.type === 'Trailer' || candidate.type === 'Teaser' ||
         candidate.type === 'Teaser Trailer')) {
      existing.type = candidate.type;
    }
    if (candidate.name && existing.name.indexOf(candidate.name) === -1) {
      existing.name += ' / ' + candidate.name;
    }
  });
  return merged;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function shiftedDate(date, days) {
  var result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return isoDate(result);
}

function parseExtraIds(value) {
  return (value || '').split(',').map(function (item) { return Number(item.trim()); })
    .filter(function (item) { return Number.isInteger(item) && item > 0; });
}

// /trailers/latest answers with an object keyed "0", "1", ...; keep movies only
function latestTrailerIds(body) {
  var ids = [];
  Object.keys(body || {}).forEach(function (key) {
    var resource = body[key] && body[key].resource;
    var id = resource && resource.type === 'movie' && Number(resource.tmdb_id);
    if (Number.isInteger(id) && id > 0 && ids.indexOf(id) === -1) ids.push(id);
  });
  return ids;
}

async function runImport(options) {
  options = options || {};
  var fetchFn = options.fetch || global.fetch;
  var sleep = options.sleep || delay;
  var logger = options.logger || console;
  var env = options.env || process.env;
  var now = options.now || new Date();
  var today = isoDate(now);
  var dbPath = options.dbPath || env.DB_PATH || '/data/reelradar.db';
  var ownsDb = !options.db;
  var db;
  var importId;
  var started = new Date().toISOString();
  var token = options.tmdbApiKey || env.TMDB_API_KEY;
  var listsPath = env.LISTS_PATH || path.join(__dirname, 'lists.json');
  var lists;
  var tmdbHeaders = { Authorization: 'Bearer ' + token, Accept: 'application/json' };
  var kcHeaders = { Accept: 'application/json' };

  if (env.KINOCHECK_API_KEY) {
    kcHeaders['X-Api-Key'] = env.KINOCHECK_API_KEY;
    kcHeaders['X-Api-Host'] = 'api.kinocheck.com';
  }
  if (ownsDb) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    db = new DatabaseSync(dbPath, { timeout: 15000 }); // wait for the server's writes instead of failing
  } else {
    db = options.db;
  }
  ensureSchema(db);
  db.prepare('INSERT INTO imports (started, status) VALUES (?, ?)').run(started, 'running');
  importId = db.prepare('SELECT last_insert_rowid() AS id').get().id;

  try {
    if (!token) throw new Error('TMDB_API_KEY is required');
    lists = JSON.parse(fs.readFileSync(listsPath, 'utf8'));

    var ids = [];
    // TMDB caps discover at 500 pages
    for (var page = 1, pages = 1; page <= pages && page <= 500; page += 1) {
      var discoverUrl = new URL(TMDB_BASE + '/discover/movie');
      discoverUrl.searchParams.set('region', 'DE');
      discoverUrl.searchParams.set('with_release_type', '3|4|6'); // theatrical, digital, TV
      discoverUrl.searchParams.set('release_date.gte', shiftedDate(now, -30));
      discoverUrl.searchParams.set('release_date.lte', shiftedDate(now, 183));
      discoverUrl.searchParams.set('sort_by', 'popularity.desc');
      discoverUrl.searchParams.set('language', 'en-US'); // English titles and texts; dates stay German (region, release_dates)
      discoverUrl.searchParams.set('page', String(page));
      if (page > 1) await sleep(250);
      var discover = await requestJson(fetchFn, discoverUrl.toString(), { headers: tmdbHeaders }, 'TMDB');
      pages = discover.total_pages || 1;
      (discover.results || []).forEach(function (movie) {
        if (ids.indexOf(movie.id) === -1) ids.push(movie.id);
      });
    }
    try {
      var latest = await requestJson(fetchFn, KINOCHECK_BASE + '/trailers/latest?limit=100&language=en',
        { headers: kcHeaders }, 'KinoCheck');
      latestTrailerIds(latest).forEach(function (id) {
        if (ids.indexOf(id) === -1) ids.push(id);
      });
    } catch (error) {
      logger.warn('KinoCheck latest trailers degraded: ' + error.message);
    }
    parseExtraIds(env.IMPORT_EXTRA_IDS).forEach(function (id) {
      if (ids.indexOf(id) === -1) ids.push(id);
    });

    var titles = [];
    for (var i = 0; i < ids.length; i += 1) {
      var id = ids[i];
      await sleep(250);
      var detail = await requestJson(fetchFn, TMDB_BASE + '/movie/' + id + '?language=en-US&append_to_response=keywords,watch/providers',
        { headers: tmdbHeaders }, 'TMDB');
      await sleep(250);
      var releaseDates = await requestJson(fetchFn, TMDB_BASE + '/movie/' + id + '/release_dates',
        { headers: tmdbHeaders }, 'TMDB');
      await sleep(250);
      var videoUrl = TMDB_BASE + '/movie/' + id +
        '/videos?include_video_language=' + encodeURIComponent(detail.original_language + ',en,de,null');
      var videos = await requestJson(fetchFn, videoUrl, { headers: tmdbHeaders }, 'TMDB');
      var kinoCheck = null;
      var kcLanguage = detail.original_language === 'de' ? 'de' : 'en';
      var kcUrl = KINOCHECK_BASE + '/movies?tmdb_id=' + id + '&language=' + kcLanguage;

      await sleep(1000);
      try {
        kinoCheck = await requestJson(fetchFn, kcUrl, { headers: kcHeaders }, 'KinoCheck');
      } catch (error) {
        if (error.status !== 404) logger.warn('KinoCheck ' + id + ' degraded: ' + error.message);
      }

      var candidates = mergeCandidates(tmdbCandidates(videos), kinoCheckCandidates(kinoCheck));
      var decisions = gate.decide(detail, candidates, lists);
      decisions.forEach(function (decision) {
        var state = decision.playable ? 'playable' : 'hidden';
        logger.log('gate ' + id + ' ' + detail.title + ' ' + decision.key + ' ' + state + ' ' + decision.reason);
      });
      var picked = gate.pickTrailer(candidates, decisions);
      var dates = germanDates(releaseDates, today);
      titles.push({
        tmdb_id: id,
        title: detail.title,
        original_title: detail.original_title,
        original_language: detail.original_language,
        de_theatrical: dates.theatrical,
        de_digital: dates.digital,
        trailer_key: picked ? picked.key : null,
        poster_path: detail.poster_path || null,
        backdrop_path: detail.backdrop_path || null,
        overview: detail.overview || null,
        providers: germanProviders(detail),
        genres: detail.genres || [],
        keywords: (detail.keywords && detail.keywords.keywords) || [],
        candidates: candidates.map(function (candidate) {
          var decision = decisions.find(function (item) { return item.key === candidate.key; });
          return Object.assign({}, candidate, decision);
        })
      });
    }

    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec('DELETE FROM candidates; DELETE FROM title_tags; DELETE FROM titles');
      var insertTag = db.prepare('INSERT OR IGNORE INTO title_tags VALUES (?, ?, ?, ?)');
      var insertTitle = db.prepare([
        'INSERT INTO titles (tmdb_id, title, original_title, original_language, de_theatrical, de_digital,',
        'trailer_key, poster_path, backdrop_path, overview) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ].join(' '));
      var insertCandidate = db.prepare([
        'INSERT INTO candidates (tmdb_id, key, source, tmdb_lang, kc_lang, type, site, name,',
        'published_at, official, kinocheck_url, playable, reason)',
        'VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ].join(' '));
      titles.forEach(function (title) {
        insertTitle.run(title.tmdb_id, title.title, title.original_title, title.original_language,
          title.de_theatrical, title.de_digital, title.trailer_key,
          title.poster_path, title.backdrop_path, title.overview);
        title.providers.forEach(function (tag) { insertTag.run(title.tmdb_id, 'provider', tag.id, tag.name); });
        title.genres.forEach(function (tag) { insertTag.run(title.tmdb_id, 'genre', tag.id, tag.name); });
        title.keywords.forEach(function (tag) { insertTag.run(title.tmdb_id, 'keyword', tag.id, tag.name); });
        title.candidates.forEach(function (candidate) {
          insertCandidate.run(title.tmdb_id, candidate.key, candidate.source, candidate.tmdb_lang,
            candidate.kc_lang, candidate.type, candidate.site, candidate.name,
            candidate.published_at, candidate.official ? 1 : 0, candidate.kinocheck_url,
            candidate.playable ? 1 : 0, candidate.reason);
        });
      });
      db.prepare('UPDATE imports SET finished = ?, status = ?, error = NULL WHERE id = ?')
        .run(new Date().toISOString(), 'success', importId);
      db.exec('COMMIT');
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
    return { importId: importId, titles: titles.length };
  } catch (error) {
    db.prepare('UPDATE imports SET finished = ?, status = ?, error = ? WHERE id = ?')
      .run(new Date().toISOString(), 'failed', error.message, importId);
    throw error;
  } finally {
    if (ownsDb) db.close();
  }
}

if (require.main === module) {
  runImport().then(function (result) {
    console.log('import ' + result.importId + ' stored ' + result.titles + ' titles');
  }).catch(function (error) {
    console.error('import failed: ' + error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  ensureSchema: ensureSchema,
  germanDates: germanDates,
  kinoCheckCandidates: kinoCheckCandidates,
  latestTrailerIds: latestTrailerIds,
  mergeCandidates: mergeCandidates,
  runImport: runImport
};
