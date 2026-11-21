'use strict';

// Seerr client (see docs/research/seerr-api.md). The API key stays here, server-side.
// Writes need the CSRF pair: a GET sets _csrf and XSRF-TOKEN cookies, the write sends both back
// plus the X-XSRF-TOKEN header.

// mediaInfo.status -> what the UI shows. Missing mediaInfo means never requested.
var STATUS = { 1: 'none', 2: 'requested', 3: 'requested', 4: 'partial', 5: 'available', 6: 'none' };

function createClient(options) {
  var env = options.env || process.env;
  var fetchImpl = options.fetch || fetch;
  var base = (env.SEERR_URL || '').replace(/\/$/, '');
  var key = env.SEERR_API_KEY;

  function call(method, path, extraHeaders, body) {
    if (!base || !key) return Promise.reject(new Error('Seerr is not configured'));
    var headers = Object.assign({ 'X-Api-Key': key, Accept: 'application/json' }, extraHeaders);
    if (body) headers['Content-Type'] = 'application/json';
    return fetchImpl(base + path, { method: method, headers: headers, body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10000) });
  }

  async function movieStatus(tmdbId) {
    var response = await call('GET', '/api/v1/movie/' + tmdbId);
    if (response.status === 404) return 'none';
    if (!response.ok) throw new Error('Seerr HTTP ' + response.status);
    var movie = await response.json();
    return (movie.mediaInfo && STATUS[movie.mediaInfo.status]) || 'none';
  }

  async function csrfHeaders() {
    var response = await call('GET', '/api/v1/status');
    var cookies = {};
    response.headers.getSetCookie().forEach(function (line) {
      var pair = line.split(';')[0].split('=');
      cookies[pair[0].trim()] = pair.slice(1).join('=');
    });
    if (!cookies['XSRF-TOKEN']) return {}; // CSRF protection switched off in Seerr
    return {
      Cookie: '_csrf=' + cookies._csrf + '; XSRF-TOKEN=' + cookies['XSRF-TOKEN'],
      'X-XSRF-TOKEN': decodeURIComponent(cookies['XSRF-TOKEN'])
    };
  }

  // Requests a movie as the key's user (auto-approved for the admin key). An existing request is fine.
  async function requestMovie(tmdbId) {
    var response = await call('POST', '/api/v1/request', await csrfHeaders(),
      { mediaType: 'movie', mediaId: tmdbId, is4k: false });
    if (!response.ok && response.status !== 409) {
      var text = await response.text();
      throw new Error('Seerr HTTP ' + response.status + ' ' + text.slice(0, 200));
    }
    return movieStatus(tmdbId);
  }

  return { movieStatus: movieStatus, requestMovie: requestMovie };
}

module.exports = { createClient: createClient, STATUS: STATUS };
