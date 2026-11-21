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
