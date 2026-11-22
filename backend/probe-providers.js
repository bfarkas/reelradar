'use strict';

// Read-only probe (OS-T-K2EQP): once a day, one JSON line per title that has a German digital date from 3 days ago to
// 14 days ahead, to measure how long TMDB lags behind a premiere. No database writes; the token is never written.
var fs = require('fs');
var DatabaseSync = require('node:sqlite').DatabaseSync;

var TMDB_BASE = 'https://api.themoviedb.org/3';

function shifted(date, days) {
  var result = new Date(date.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result.toISOString().slice(0, 10);
}

function delay(ms) {
  return new Promise(function (resolve) { setTimeout(resolve, ms); });
}

async function probe(options) {
  options = options || {};
  var env = options.env || process.env;
  var fetchFn = options.fetch || global.fetch;
  var sleep = options.sleep || delay;
  var now = options.now || new Date();
  var token = env.TMDB_API_KEY;
  var outPath = options.outPath || env.PROBE_OUT || '/data/provider-probe.jsonl';
  if (!token) throw new Error('TMDB_API_KEY is required');

  var db = new DatabaseSync(options.dbPath || env.DB_PATH || '/data/reelradar.db', { readOnly: true });
  var rows;
  try {
    rows = db.prepare('SELECT media_type, tmdb_id, title, de_digital FROM titles ' +
      'WHERE de_digital >= ? AND de_digital <= ? ORDER BY de_digital, tmdb_id').all(shifted(now, -3), shifted(now, 14));
    var expected = db.prepare("SELECT name FROM title_tags WHERE media_type = ? AND tmdb_id = ? AND kind = 'provider_expected' ORDER BY name");
    rows.forEach(function (row) { row.expected = expected.all(row.media_type, row.tmdb_id).map(function (tag) { return tag.name; }); });
  } finally {
    db.close();
  }

  var lines = [];
  for (var i = 0; i < rows.length; i += 1) {
    var row = rows[i];
    if (i) await sleep(250);
    var url = TMDB_BASE + '/' + row.media_type + '/' + row.tmdb_id + '/watch/providers';
    var body = await fetchFn(url, { headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } })
      .then(function (response) {
        if (!response.ok) throw new Error('TMDB returned HTTP ' + response.status + ' for ' + url);
        return response.json();
      });
    var de = (body && body.results && body.results.DE) || {};
    lines.push(JSON.stringify({
      run: now.toISOString().slice(0, 10),
      media_type: row.media_type,
      tmdb_id: row.tmdb_id,
      title: row.title,
      de_digital: row.de_digital,
      flatrate: (de.flatrate || []).map(function (p) { return p.provider_name; }),
      buy: !!(de.buy && de.buy.length),
      rent: !!(de.rent && de.rent.length),
      ads: !!(de.ads && de.ads.length),
      expected: row.expected
    }));
  }
  // Written only after all requests succeeded: a failed run leaves no half day in the file.
  if (lines.length) fs.appendFileSync(outPath, lines.join('\n') + '\n');
  return lines.length;
}

if (require.main === module) {
  probe().then(function (count) {
    console.log('probe wrote ' + count + ' lines');
  }).catch(function (error) {
    console.error('probe failed: ' + error.message);
    process.exitCode = 1;
  });
}

module.exports = { probe: probe };
