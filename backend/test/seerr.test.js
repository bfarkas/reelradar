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
  assert.equal(await c.movieStatus(1), 'none');
  assert.equal(await c.movieStatus(2), 'requested');
  assert.equal(await c.movieStatus(3), 'available');
});

test('requests a movie with the CSRF pair and returns the new status', async function () {
  var calls = [];
  assert.equal(await client(calls).requestMovie(1), 'requested');
  assert.deepEqual(calls, ['GET /api/v1/status', 'POST /api/v1/request', 'GET /api/v1/movie/1']);
});

test('an existing request (409) counts as success', async function () {
  assert.equal(await client([]).requestMovie(2), 'requested');
});

test('fails clearly when Seerr is not configured', async function () {
  await assert.rejects(seerr.createClient({ env: {} }).movieStatus(1), /not configured/);
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
  var ids = Array.from({ length: 620 }, function (_, i) { return i + 1; });
  var result = await c.movieStatuses(ids);
  assert.equal(Object.keys(result).length, 619);
  assert.equal(result[7], undefined);
  assert.equal(result[1], 'available');
  assert.equal(result[2], 'none');
  assert.ok(peak <= 8, 'peak concurrency ' + peak);
});

test('gives up quickly when Seerr is down', async function () {
  var calls = 0;
  var c = seerr.createClient({ env: { SEERR_URL: 'http://seerr', SEERR_API_KEY: 'k' }, fetch: async function () {
    calls++;
    throw new TypeError('fetch failed');
  } });
  var result = await c.movieStatuses(Array.from({ length: 620 }, function (_, i) { return i + 1; }));
  assert.deepEqual(result, {});
  assert.ok(calls < 20, 'calls ' + calls);
});
