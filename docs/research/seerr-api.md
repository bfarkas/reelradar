# Seerr API (v3.5.2) - findings for ReelRadar

Researched read-only (GET only) on rei3. Key always `<KEY>`. Sources: docs.seerr.dev/api/seerr-api/, seerr-api.yml (OpenAPI spec on GitHub), live instance.

Base: `http://192.168.42.57:5055` (rei3 LAN). Auth: header `X-Api-Key: <KEY>`.
`/api/v1/api-docs` is NOT exposed (404); use the yml on GitHub.

## Verified GET calls (all 200 with key)
- `GET /api/v1/status` -> `{"version":"3.5.2",...}`; works with no key at all.
- `GET /api/v1/search?query=matrix&language=de` -> `{page,totalPages,totalResults,results[]}`; each result has `mediaType` (movie|tv|person), `id` (= TMDB id), `title`/`name`, German overview. `mediaInfo` is present only if Seerr knows the title (absent/null otherwise). Same for TV (`breaking bad` -> tv 1396).
- `GET /api/v1/movie/{tmdbId}?language=de`, `GET /api/v1/tv/{tmdbId}?language=de` -> details plus `mediaInfo.status`, `mediaInfo.requests[]`, and for TV `mediaInfo.seasons[]`.
- `GET /api/v1/request?take=N&skip=M&filter=all|pending|approved|available|...` -> `{pageInfo,results[]}`; each has `id,type,status,media{tmdbId,status},requestedBy{id,...}`.
- `GET /api/v1/user`, `/user/1` -> 200 with key.

## Auth findings
- No key: search 401, /user 401, /status 200.
- Wrong key: 403.
- Valid key without session cookie works for search/status/movie/tv/request AND /user (the 3.2.0 cookie-only issue is gone in 3.5.2).
- Key owner is user id 1 (permissions 2 = ADMIN). VERIFIED 2026-11-21: a request created with the key is attributed to user 1 (`requestedBy.id` = `modifiedBy.id` = 1) and is auto-approved at once (request status 2, media status 3, sent to Radarr). Per the spec, `userId` in the body would attribute it to another user (needs MANAGE_REQUESTS); UNVERIFIED.
- Users 3-5 on this instance have permissions 32 (REQUEST only, no auto-approve).

## Status codes
mediaInfo.status (media availability): 1 unknown, 2 pending, 3 processing (approved, downloading), 4 partially available, 5 available, 6 deleted. mediaInfo missing = never requested.
Request.status: 1 pending approval, 2 approved, 3 declined (spec); observed also 5 on a request for an available movie (completed).
Observed: movie 1457866 -> media 3 / request 2 (requested, processing); tv 107113 -> media 3 / request 385 status 2; movie 399174 -> media 5 / request 5 (available).
4K has separate `status4k`.

## CSRF protection (blocks writes)
This instance has CSRF protection on. Every POST/DELETE, **even with a valid `X-Api-Key`**, returns `403 {"message":"invalid csrf token"}` unless it carries the CSRF pair. Any GET response sets two cookies: `_csrf` (HttpOnly) and `XSRF-TOKEN`, both `Secure; SameSite=Strict`. Over plain HTTP, curl's cookie jar drops Secure cookies, so read them from the `Set-Cookie` headers. Then send:
```
Cookie: _csrf=<_csrf>; XSRF-TOKEN=<token>
X-XSRF-TOKEN: <token>
```
The ReelRadar backend must do this: one GET (e.g. `/api/v1/status`) to get the pair, then the write. The alternative is switching CSRF protection off in Seerr's network settings (not done).

## POST /api/v1/request - VERIFIED 2026-11-21
Test with the owner's go-ahead: movie "Ebenezer" (TMDB 1567605).
- `POST /api/v1/request`, body `{"mediaType":"movie","mediaId":1567605,"is4k":false}`, with key and CSRF pair -> **201**, MediaRequest `id 387, status 2 (approved), requestedBy 1, media.status 2`. Seconds later `GET /movie/1567605` shows `mediaInfo.status 3` (processing) and `externalServiceId 479` (the Radarr id).
- Same POST again -> **409** `{"message":"Request for this media already exists."}`.
- `DELETE /api/v1/request/387` (with CSRF pair) -> **204**. Then `GET /request/387` -> 404, and the movie shows `mediaInfo.status 1` with no requests. **Deleting the request does not remove the movie from Radarr**; the download continues.
- Spec body for TV: `"seasons":[1,2]|"all"`; optional `tvdbId,serverId,profileId,rootFolder,languageProfileId,userId,ignoreQuota`. Untested.

## Reachability from backend container
Seerr is on docker network `homeserver_arr-suite` (gateway 172.19.0.1). `docker run --rm curlimages/curl http://192.168.42.57:5055/api/v1/status` -> 200. Simplest: `SEERR_URL=http://192.168.42.57:5055` from the ReelRadar container (works with default bridge). `host.docker.internal` would need `extra_hosts: host.docker.internal:host-gateway` in compose (untested).

## Untested
TV requests (seasons), `userId` attribution to another user, quota behaviour.
