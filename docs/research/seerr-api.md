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
- Key owner is user id 1 (permissions 2 = ADMIN). Per docs/spec a key-created request is attributed to that user (id 1) unless `userId` is passed in the body (needs MANAGE_REQUESTS). UNVERIFIED (not testable read-only). Admin => requests are auto-approved => triggers Radarr/Sonarr immediately.

## Status codes
mediaInfo.status (media availability): 1 unknown, 2 pending, 3 processing (approved, downloading), 4 partially available, 5 available, 6 deleted. mediaInfo missing = never requested.
Request.status: 1 pending approval, 2 approved, 3 declined (spec); observed also 5 on a request for an available movie (completed).
Observed: movie 1457866 -> media 3 / request 2 (requested, processing); tv 107113 -> media 3 / request 385 status 2; movie 399174 -> media 5 / request 5 (available).
4K has separate `status4k`.

## POST /api/v1/request - UNTESTED
Body (JSON): `{"mediaType":"movie"|"tv","mediaId":<tmdbId>,"seasons":[1,2]|"all" (tv),"is4k":false}`; optional `tvdbId,serverId,profileId,rootFolder,languageProfileId,userId,ignoreQuota`. Success: 201 + MediaRequest. Needs REQUEST permission. Duplicate request presumably 409 (unverified).

## Reachability from backend container
Seerr is on docker network `homeserver_arr-suite` (gateway 172.19.0.1). `docker run --rm curlimages/curl http://192.168.42.57:5055/api/v1/status` -> 200. Simplest: `SEERR_URL=http://192.168.42.57:5055` from the ReelRadar container (works with default bridge). `host.docker.internal` would need `extra_hosts: host.docker.internal:host-gateway` in compose (untested).

## Untested
Creating a request (awaiting owner go-ahead with a title), duplicate/error codes, attribution, quota behaviour.
