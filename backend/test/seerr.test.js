'use strict';

var test = require('node:test');
var assert = require('node:assert/strict');
var seerr = require('../seerr');

// Fake Seerr: status sets the CSRF cookies; request needs them; movie 2 is already requested.
function fakeSeerr(calls) {
  var media = { 1: null, 2: { status: 3 }, 3: { status: 5 } };
  return async function (url, init) {
    var path = url.replace('http://seerr', '');
    calls.push(init.method + ' ' + path);
    assert.equal(init.headers['X-Api-Key'], 'k');
    if (path === '/api/v1/status') {
      return new Response('{}', { headers: [['Set-Cookie', '_csrf=abc; Path=/; Secure'], ['Set-Cookie', 'XSRF-TOKEN=t%2Bk; Path=/; Secure']] });
    }
    if (path === '/api/v1/request') {
      if (init.headers.Cookie !== '_csrf=abc; XSRF-TOKEN=t%2Bk' || init.headers['X-XSRF-TOKEN'] !== 't+k') {
        return new Response('{"message":"invalid csrf token"}', { status: 403 });
      }
      var id = JSON.parse(init.body).mediaId;
      if (media[id]) return new Response('{}', { status: 409 });
      media[id] = { status: 2 };
      return new Response('{}', { status: 201 });
    }
    var movie = path.match(/^\/api\/v1\/movie\/(\d+)$/);
    if (movie) return Response.json({ id: Number(movie[1]), mediaInfo: media[movie[1]] || undefined });
    return new Response('', { status: 404 });
  };
}

function client(calls) {
  return seerr.createClient({ env: { SEERR_URL: 'http://seerr/', SEERR_API_KEY: 'k' }, fetch: fakeSeerr(calls) });
}

test('maps Seerr media status to none, requested and available', async function () {
  var c = client([]);
  assert.equal(await c.mediaStatus('movie', 1), 'none');
  assert.equal(await c.mediaStatus('movie', 2), 'requested');
  assert.equal(await c.mediaStatus('movie', 3), 'available');
});

test('requests a movie with the CSRF pair and returns the new status', async function () {
  var calls = [];
  assert.equal(await client(calls).requestMedia('movie', 1), 'requested');
  assert.deepEqual(calls, ['GET /api/v1/status', 'POST /api/v1/request', 'GET /api/v1/movie/1']);
});

test('an existing request (409) counts as success', async function () {
  assert.equal(await client([]).requestMedia('movie', 2), 'requested');
});

test('fails clearly when Seerr is not configured', async function () {
  await assert.rejects(seerr.createClient({ env: {} }).mediaStatus('movie', 1), /not configured/);
});

test('looks up many titles with bounded concurrency and leaves a failing title out', async function () {
  var running = 0;
  var peak = 0;
  var c = seerr.createClient({ env: { SEERR_URL: 'http://seerr', SEERR_API_KEY: 'k' }, fetch: async function (url) {
    var id = Number(url.split('/').pop());
    running++;
    peak = Math.max(peak, running);
    await new Promise(function (resolve) { setTimeout(resolve, 1); });
    running--;
    if (id === 7) throw new TypeError('fetch failed');
    return Response.json({ id: id, mediaInfo: id % 2 ? { status: 5 } : undefined });
  } });
  var ids = Array.from({ length: 620 }, function (_, i) { return { media_type: 'movie', tmdb_id: i + 1 }; });
  var result = await c.mediaStatuses(ids);
  assert.equal(Object.keys(result).length, 619);
  assert.equal(result['movie:7'], undefined);
  assert.equal(result['movie:1'], 'available');
  assert.equal(result['movie:2'], 'none');
  assert.ok(peak <= 8, 'peak concurrency ' + peak);
});

test('gives up quickly when Seerr is down', async function () {
  var calls = 0;
  var c = seerr.createClient({ env: { SEERR_URL: 'http://seerr', SEERR_API_KEY: 'k' }, fetch: async function () {
    calls++;
    throw new TypeError('fetch failed');
  } });
  var result = await c.mediaStatuses(Array.from({ length: 620 }, function (_, i) { return { media_type: 'movie', tmdb_id: i + 1 }; }));
  assert.deepEqual(result, {});
  assert.ok(calls < 20, 'calls ' + calls);
});

// ---- series (OS-T-J0NCM): same id as a movie, mediaType tv, first regular season only ----
// Fake Seerr with a movie and a series that share id 5, and series with other season layouts.
function fakeSeerrWithSeries(calls) {
  var seasons = {
    5: [{ seasonNumber: 0 }, { seasonNumber: 1 }, { seasonNumber: 2 }],
    6: [{ seasonNumber: 0 }, { seasonNumber: 2 }, { seasonNumber: 3 }], // no season 1
    7: [{ seasonNumber: 0 }],                                         // specials only
    8: []
  };
  var requested = { 'movie:5': { status: 5 } };
  return async function (url, init) {
    var path = url.replace('http://seerr', '');
    calls.push(init.method + ' ' + path + (init.body ? ' ' + init.body : ''));
    if (path === '/api/v1/status') return new Response('{}', { headers: [['Set-Cookie', '_csrf=abc'], ['Set-Cookie', 'XSRF-TOKEN=t']] });
    if (path === '/api/v1/request') {
      var body = JSON.parse(init.body);
      requested[body.mediaType + ':' + body.mediaId] = { status: 3 };
      return new Response('{}', { status: 201 });
    }
    var found = path.match(/^\/api\/v1\/(movie|tv)\/(\d+)$/);
    if (!found) return new Response('', { status: 404 });
    if (found[1] === 'tv' && !seasons[found[2]]) return new Response('', { status: 404 });
    return Response.json({ id: Number(found[2]), seasons: found[1] === 'tv' ? seasons[found[2]] : undefined, mediaInfo: requested[found[1] + ':' + found[2]] });
  };
}

function seriesClient(calls) {
  return seerr.createClient({ env: { SEERR_URL: 'http://seerr', SEERR_API_KEY: 'k' }, fetch: fakeSeerrWithSeries(calls) });
}
function posts(calls) {
  return calls.filter(function (call) { return call.indexOf('POST') === 0; });
}

test('a movie and a series with the same id have separate status', async function () {
  var c = seriesClient([]);
  assert.equal(await c.mediaStatus('movie', 5), 'available');
  assert.equal(await c.mediaStatus('tv', 5), 'none');
  assert.equal(await c.mediaStatus('tv', 999), 'none'); // unknown to Seerr
  assert.deepEqual(await c.mediaStatuses([{ media_type: 'movie', tmdb_id: 5 }, { media_type: 'tv', tmdb_id: 5 }]),
    { 'movie:5': 'available', 'tv:5': 'none' });
});

test('a series request asks for season 1 only, with mediaType tv', async function () {
  var calls = [];
  var c = seriesClient(calls);
  assert.equal(await c.requestMedia('tv', 5), 'requested');
  assert.deepEqual(posts(calls), ['POST /api/v1/request {"mediaType":"tv","mediaId":5,"is4k":false,"seasons":[1]}']);
  assert.equal(await c.mediaStatus('movie', 5), 'available'); // the movie with the same id is untouched
});

test('a series that starts after season 1 asks for its first regular season; specials alone cannot be requested', async function () {
  var calls = [];
  var c = seriesClient(calls);
  await c.requestMedia('tv', 6);
  assert.match(posts(calls)[0], /"seasons":\[2\]/);
  calls.length = 0;
  await assert.rejects(c.requestMedia('tv', 7), /no regular season/);
  await assert.rejects(c.requestMedia('tv', 8), /no regular season/);
  assert.deepEqual(posts(calls), []);
});
