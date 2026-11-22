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

  // mediaType is 'movie' or 'tv': Seerr and TMDB reuse ids between the two.
  async function mediaDetail(mediaType, tmdbId) {
    var response = await call('GET', '/api/v1/' + mediaType + '/' + tmdbId);
    if (response.status === 404) return null;
    if (!response.ok) throw new Error('Seerr HTTP ' + response.status);
    return response.json();
  }

  async function mediaStatus(mediaType, tmdbId) {
    var detail = await mediaDetail(mediaType, tmdbId);
    return (detail && detail.mediaInfo && STATUS[detail.mediaInfo.status]) || 'none';
  }

  // Statuses for many titles ([{media_type, tmdb_id}]) through a small pool, so Seerr isn't hit with hundreds of
  // parallel requests; result is keyed 'movie:603' / 'tv:1396'. A failing title is left out (unknown); after 5
  // failures in a row Seerr counts as down and the rest is skipped.
  async function mediaStatuses(refs) {
    var result = {};
    var next = 0;
    var failedInRow = 0;
    async function worker() {
      while (next < refs.length && failedInRow < 5) {
        var ref = refs[next++];
        try { result[refKey(ref.media_type, ref.tmdb_id)] = await mediaStatus(ref.media_type, ref.tmdb_id); failedInRow = 0; } catch (error) { failedInRow++; }
      }
    }
    await Promise.all(Array.from({ length: 8 }, worker));
    return result;
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

  // First regular season of a series: the lowest number from 1 up (Seerr/TMDB number specials as season 0, and a
  // series can start at season 2). Null when there are only specials, or no seasons are known.
  function firstSeason(detail) {
    var numbers = ((detail && detail.seasons) || []).map(function (season) { return season.seasonNumber; })
      .filter(function (number) { return number >= 1; });
    return numbers.length ? Math.min.apply(null, numbers) : null;
  }

  // Requests a movie, or the first season of a series, as the key's user (auto-approved for the admin key).
  // An existing request is fine.
  async function requestMedia(mediaType, tmdbId) {
    var body = { mediaType: mediaType, mediaId: tmdbId, is4k: false };
    if (mediaType === 'tv') {
      var season = firstSeason(await mediaDetail('tv', tmdbId));
      if (season === null) throw new Error('Seerr lists no regular season to request');
      body.seasons = [season];
    }
    var response = await call('POST', '/api/v1/request', await csrfHeaders(), body);
    if (!response.ok && response.status !== 409) {
      var text = await response.text();
      throw new Error('Seerr HTTP ' + response.status + ' ' + text.slice(0, 200));
    }
    return mediaStatus(mediaType, tmdbId);
  }

  return { mediaStatus: mediaStatus, mediaStatuses: mediaStatuses, requestMedia: requestMedia };
}

function refKey(mediaType, tmdbId) {
  return mediaType + ':' + tmdbId;
}

module.exports = { createClient: createClient, refKey: refKey, STATUS: STATUS };
