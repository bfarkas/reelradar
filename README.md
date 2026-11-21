# reelradar
ReelRadar is a self-hosted movie and TV discovery service inspired by the discontinued Apple Trailers experience. It helps users discover upcoming and recently released films and series.

## Run / configure

Docker Compose stack: `backend` (Node 24, plain `http`, SQLite at `/data/reelradar.db` in the named volume `reelradar-data`, boot counter exposed at `/api/health`) and `frontend` (nginx:alpine, placeholder page, proxies `/api/` to the backend). The frontend is published on `127.0.0.1:8180` only. Caddy is not part of this stack.

```sh
cp .env.example .env     # fill in TMDB_API_KEY, KINOCHECK_API_KEY, SEERR_URL, SEERR_API_KEY (.env is git-ignored)
docker compose up -d --build
curl http://127.0.0.1:8180/api/health
```

Frontend JS must stay ES5 (target: Tizen 4.0 / Chromium M56).

## Proof of concept import

Set `TMDB_API_KEY` in `.env`, rebuild the stack, then run:

```sh
docker compose exec backend node import.js
```

`IMPORT_LIMIT` controls how many discover results are imported (default 20),
`IMPORT_EXTRA_IDS` is a comma-separated list of extra TMDB movie IDs, and
`IMPORT_ON_START=1` runs one import whenever the backend starts. `KINOCHECK_API_KEY`
is optional. Allow/deny overrides live in `backend/lists.json`.

This product uses the TMDB API but is not endorsed or certified by TMDB.
KinoCheck trailers link back to KinoCheck as their source.

## Reverse proxy (existing Caddy, host network)

`deploy/Caddyfile.example` serves the app on plain HTTP at `http://<lan-ip>:8095`, LAN/private ranges only:

```
http://:8095 {
	@outside not remote_ip private_ranges
	abort @outside
	reverse_proxy 127.0.0.1:8180
}
```

Apply: back up the Caddyfile, append the block, validate, reload (never restart):

```sh
cd <homeserver>/caddy && cp Caddyfile Caddyfile.bak-reelradar-$(date +%F)
cat <path-to-reelradar>/deploy/Caddyfile.example >> Caddyfile
docker exec caddy caddy validate --config /etc/caddy/Caddyfile
docker exec caddy caddy reload --config /etc/caddy/Caddyfile
```

## Genre and keyword filter

The list page has a Filter panel listing the TMDB genres and keywords of the imported titles; keywords are ordered by how many titles carry them, with a search box. A title is shown if it has **any** selected genre or keyword; with nothing selected, everything is shown. The selection lives only in the browser, in localStorage key `reelradar.filter` as `{"v":1,"genres":[ids],"keywords":[ids]}`; the server stores no per-user data. If localStorage is unavailable or holds something else, the page shows everything. The import stores genres and keywords in the `title_tags` table (via `append_to_response=keywords`).

## TV app (Tizen) and trailer streams

`tv-app/` is a fullscreen Tizen 4.0 web app for the Samsung TV (package `reelradar1`, app id `reelradar1.ReelRadar`). It shows the title list with German dates and the genre/keyword filter, and it plays trailers fullscreen itself. Navigation uses only arrows, OK and Back. Back closes the player, then the filter, then the app. The filter is stored in the app's localStorage, so it survives a restart. In the player, OK and Play/Pause pause, and Left/Right seek ±10 s.

**Stream approach.** The TV app doesn't use a YouTube player. The backend downloads each picked trailer once with yt-dlp as an H.264/AAC MP4 (up to 1080p) into `/data/media/`. The frontend nginx serves those files at `/media/<key>.mp4`, with Range support. `GET /api/stream/<tmdb_id>` returns `{key, url}`. On a title's first request, it downloads the file before answering.

If YouTube refuses a video (private, removed, geo-blocked), the backend marks that candidate unplayable with the yt-dlp error as the reason and tries the next playable candidate. If no original-language trailer is playable (or downloadable), candidates hidden only for language stand in (owner rule, 2026-11-22). The order is: subtitled versions first (original audio), then dubbed ones; within each group, English, then German, then others. Subtitled vs. dubbed is guessed from the video name (Subtitled, OmU, UT, ...). Only when none of those is left does the title have no trailer.

These are cached copies of YouTube videos for private household use on the LAN only. Never expose `/media/` or `/api/stream/` beyond the LAN.

Fill the cache after an import (takes a few minutes; about 30 MB per trailer):
```
docker compose exec -T backend node prefetch.js
```
shortcut: a re-import resets candidates, so a dead video is tried once more on its next stream or prefetch request. The cache is never pruned. Delete `/data/media/*.mp4` by hand if the disk fills.

**Build and install** (Tizen Studio CLI, certificate profile `hideki`, TV in developer mode pointing at this Mac):
```
tizen package -t wgt -s hideki -o out -- tv-app/
sdb connect 192.168.42.54:26101
tizen install -n ReelRadar.wgt -s 192.168.42.54:26101 -- out
```
Launch it from Apps, or from here with `cd spikes/tv && node remote.mjs launch reelradar1.ReelRadar`. The API address is fixed at the top of `tv-app/index.html` (`API`).

## Seerr requests

Each title shows its Seerr state: requested, partly in the library, or in the library. Titles that aren't requested yet get a request button. On the TV, press Right on a row to reach **Request**, then OK.

The backend talks to Seerr with `SEERR_URL` and `SEERR_API_KEY` from `.env`; the key never reaches the browser. Writes fetch Seerr's CSRF cookie pair first.
- `GET /api/seerr` returns `{tmdb_id: none|requested|partial|available}`, cached for a minute.
- `POST /api/request/<tmdb_id>` sends the request. A title that is already requested counts as success.

The backend refuses POSTs whose `Origin` is another website. Allowed are the page itself and the TV app (file origin). Requests are made as the key's user (admin, auto-approved).

## Views

Both the web page and the TV app have five views, and each one respects the genre/keyword filter:
- **Upcoming** (default): German theatrical or digital release in the next 90 days, soonest first.
- **New trailers**: most recently published trailers first.
- **Recently released**: German release in the last 90 days, newest first.
- **Genres**: one shelf per genre. On the TV the shelves are horizontal rows: Left/Right moves along a shelf, Up/Down moves between shelves.
- **All**: everything, in German theatrical date order.

## Scheduled import

The backend imports once a day at `IMPORT_TIME`, set in `.env` (default `04:00`, local time: compose sets `TZ=Europe/Berlin`). After each successful import it caches the newly picked trailers (prefetch). Runs never overlap, and `IMPORT_ON_START=1` uses the same guarded job. A failed import keeps the previous catalogue and is logged. Scheduled runs read `IMPORT_EXTRA_IDS` from `.env`.
