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

The import takes every German theatrical, digital and TV release from 30 days ago
to 6 months ahead (all TMDB discover pages), plus the movies behind KinoCheck's
100 latest trailers. Titles, synopses and genres are in English; release dates
and streaming services are German. Where TMDB has no English synopsis, the German one
is stored instead (taken from the `translations` appended to the same detail request, no
extra call) and shown with a small "DE" marker (`overview_lang = 'de'` in the database and in `/api/titles`);
titles with neither stay without a synopsis. TMDB lists a flatrate service only once a title streams, so for an
upcoming German digital release the note of its release_dates type 4 entry ("Netflix", "Prime Video", ...) is read
against `backend/expected-providers.json` (one data table, no per-service code) and stored as a `provider_expected`
tag (`providers_expected` in `/api/titles`); production companies of a different service veto it, and unknown stays
unknown. The release calendar lists such titles under that service as "Premieres on X". `IMPORT_EXTRA_IDS` and `IMPORT_EXTRA_TV_IDS` are comma-separated lists of extra TMDB movie and series IDs, and
`IMPORT_ON_START=1` runs one import whenever the backend starts. `KINOCHECK_API_KEY`
is optional but needed at this volume (1,000 requests/day without it). Allow/deny overrides live in `backend/lists.json`.

**Series.** TV series are imported next to the movies (`media_type` `tv` in the database and in `/api/titles`; TMDB reuses ids between movies and series, so identity is `(media_type, tmdb_id)` in titles, candidates, tags, trailer lookups, `/api/stream`, `/api/request` and the Seerr status keys). The series come from two `/discover/tv` queries, both for series that first aired from 30 days ago to 6 months ahead: those on a German flatrate service already, and the most popular ones TMDB lists no German service for yet (`IMPORT_TV_PAGES` pages of 20 each, default 3), plus the shows behind KinoCheck's latest trailers. A series has no German dates: they stay empty, and a US or origin `first_air_date` is never used. What is shown instead is "Available on X in Germany" from `/tv/{id}` `watch/providers` DE flatrate, and nothing when TMDB has none. Because a series has no date, it is not in the Release calendar or Recently released; it is in New trailers, Genres and All titles. It is never under Cinema, and under Streaming only while a German service lists it. Trailers go through the same gate, fallback and cache as movie trailers (TMDB `/tv/{id}/videos`, KinoCheck `/shows`). A database from before series existed is migrated by `ensureSchema` when the backend or an import starts: its tables are rebuilt with `media_type` and every row becomes a movie.

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

**Stream approach.** The TV app doesn't use a YouTube player. The backend downloads each picked trailer once with yt-dlp (H.264/AAC, up to 1080p) into `/data/media/`, then transcodes it with ffmpeg to HEVC tagged `hvc1` + AAC with `+faststart`, still an MP4. The frontend nginx serves those files at `/media/<key>.mp4`, with Range support. `GET /api/stream/<movie|tv>/<tmdb_id>` returns `{key, url}` (a bare `/api/stream/<tmdb_id>` is a movie). On a title's first request, it downloads the file before answering.

**Transcode and KinoCheck idents.** The transcode runs under `nice -n 19` and replaces the download only if the result passes an `ffprobe` check (HEVC `hvc1`, AAC, duration matches); it is written to a temp file and renamed atomically. Any failure keeps the original H.264 file. For trailers whose candidate came from KinoCheck (`source` kinocheck or both), KinoCheck's own ident is cut during the same encode, but only when `KINOCHECK_TRIM=1` is set (off by default until the cut has been seen working in the live app). The ident is found by its look, not by black frames (`backend/kinocheck.js`). Start: a ~3 s logo animation (chevron plus the KINOCHECK wordmark on a coloured backdrop) that ends in a hard cut; it is recognised by correlating the wordmark area with a stored template (`spikes/kinocheck-template.js` rebuilds it) at 2 s and just before a hard cut at 2.8-3.4 s while the picture is at rest. End: a still of a trailer scene, a red wipe within ~0.25 s, then a static red card to the end of the file (10-15 s); it is recognised by that sequence, and the cut goes at the jump to the still (a black frame or two the trailer itself ends on stay). The cut goes halfway between the last ident frame and the first trailer frame, so no trailer frame is removed. An end that does not match is left uncut (the small KinoCheck watermark in the corner of the trailer itself is never touched), and a cut never leaves less than 30 s. The 2017 version of the intro (ghosted wordmark) and a few teal-backdrop intros with a washed-out wordmark are not matched and stay in. Measured on all 122 cached KinoCheck trailers (2017-2026): intro found in 118, outro in 122, no cut in a wrong place (about 40 of them checked frame by frame; the starts all fall at 2.98-3.07 s, the ends all leave a 15.1 s card, one a 10.1 s card). A scan whose ffmpeg output comes back short is repeated once, then the file is transcoded uncut. On backend start, and after each daily import, a background pass transcodes files cached earlier, one at a time, waiting while any download, import or prefetch runs. A file it could not convert is retried after the next restart.

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
- `GET /api/seerr` returns `{"movie:<tmdb_id>"|"tv:<tmdb_id>": none|requested|partial|available}`, cached for a minute.
- `POST /api/request/<movie|tv>/<tmdb_id>` sends the request (a bare id is a movie). A title that is already requested counts as success.
- A series request asks for the first season only (`seasons: [n]`, button "Request season 1 via Seerr"). `n` is the lowest regular season number in Seerr's season list (season 0 is specials), so it is 1 unless the series starts later; a series with only specials cannot be requested and the request fails.

The backend refuses POSTs whose `Origin` is another website. Allowed are the page itself and the TV app (file origin). Requests are made as the key's user (admin, auto-approved).

## Views

Both the web page and the TV app follow the "Screening room" design (Concept 03). They have five views, and each one respects the genre/keyword filter:
- **Release calendar** (default): German cinema and streaming releases in the next 6 months. The web page groups them by day; each cinema or streaming release is its own entry.
- **New trailers**: most recently published trailers first.
- **Recently released**: German releases in the last 90 days, newest first.
- **Genres**: one shelf per genre.
- **All titles**: everything.

The web page adds All / Cinema / Streaming chips and a streaming-service filter (German subscription services from TMDB/JustWatch; resold channels and ad tiers are dropped). It plays trailers from the same cached MP4 as the TV (`/api/stream`), and works at phone width.

On the TV, a hero at the top shows the focused poster's backdrop, title, date, synopsis, Play trailer and Request via Seerr; poster rows sit below. Left/Right moves along a row, Up goes to Play trailer, Down returns to the poster.

**Poster wall** (second mockup) is a denser alternative layout on both. On the web page, the grid/list toggle in the filter bar switches it (remembered per browser): a poster grid with a Cinema or service badge and the date, a hover tip, and the full card in a dialog on click; three columns on phones. On the TV, the Wall/Rows button in the header switches it: a poster grid with an info bar (title, date, where, Request via Seerr) at the bottom; OK on a poster plays the trailer, Down from the last row reaches the request button.

To preview the TV app in a desktop browser, serve `tv-app/` over HTTP (`.claude/launch.json` has a `python3 -m http.server` entry on port 8765); opened as a file it can't reach the API.

## Scheduled import

The backend imports once a day at `IMPORT_TIME`, set in `.env` (default `04:00`, local time: compose sets `TZ=Europe/Berlin`). After each successful import it caches the newly picked trailers (prefetch). Runs never overlap, and `IMPORT_ON_START=1` uses the same guarded job. A failed import keeps the previous catalogue and is logged. Scheduled runs read `IMPORT_EXTRA_IDS` from `.env`.
