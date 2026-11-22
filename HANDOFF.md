# Handoff

Goal: work through the ReelRadar tasks in OctoSprout (project OS-P-3NEBD). Commit and push straight to `main`, with no branches or PRs.

## State (2026-11-22, ~01:00)
- Owner asked for, in order: fallback order, Seerr requests, feed and shelves, scheduled imports. Each has an OctoSprout task, proposed in OS-PROP-65TMT (needs the owner's approval): OS-T-2HEYH (fallback), OS-T-4NSJA (Seerr), OS-T-C7YJA (views), OS-T-WSDF9 (schedule). All four are built.
  - Fallback and Seerr: commit f752764.
  - Views and scheduler: committed after that.
- Still open:
  - A real Seerr request from the TV, done by the owner.
  - An owner check of the views on the TV.
  - Remove the test `IMPORT_TIME=` line from ~/reelradar/.env on rei3 after the test run.
  - Record the fallback rule in ADR OS-D-51H34.
  - Log progress on the four tasks once they're approved.

## Earlier state (2026-11-22, late)
- OS-T-MDTV6 (Tizen TV app): built, commit 3fa98b3, installed on the TV (`reelradar1.ReelRadar`). The owner confirmed the navigation and that trailers play with sound. The task is still `in_progress` only because of Spirited Away (tmdb 129): its only ja trailer (etiQRSOkOIg) is private, and its other candidates are en/de, which the language gate hides.
- Owner decision (2026-11-22): "if no original language trailer can be played, allow what is available, preferably english."
  In progress: a language fallback in `backend/gate.js`, used by both the import (`pickTrailer` in import.js:246) and `backend/media.js` `ensureTitleTrailer`. When no candidate is playable, candidates rejected only for language become eligible: English first, then any other language. Candidates rejected for type, deny list, or "unavailable for download" stay excluded. Then: test, deploy, re-import, prefetch, check that Spirited Away (expect GAp2_0JJskk or ByXuk9QqQkk) and Mockingjay 131631 (en geo-blocked in DE, so a de trailer is expected) play, then close OS-T-MDTV6.
- ADR proposals: the owner should approve OS-PROP-8XWT8 and reject OS-PROP-YG8AG and OS-PROP-Z0K5B. OS-D-51H34 is still DRAFT.
- Stream approach: README "TV app (Tizen) and trailer streams". Cache: /data/media on rei3. Prefetch with `docker compose exec -T backend node prefetch.js`.
- Deploy: `COPYFILE_DISABLE=1 tar -cf - <files> | ssh rei3.local 'cd ~/reelradar && tar -x && docker compose up -d --build <svc>'`. Import: `docker compose exec -T -e IMPORT_EXTRA_IDS=496243,915935,940721,906126,49046,705996,129 backend node import.js`.
- TV: 192.168.42.54. Remote: `cd spikes/tv && TV_TOKEN=<from transcript> node remote.mjs launch reelradar1.ReelRadar | KEY_...`. If sdb won't connect, run `sdb kill-server` first. Photo Booth shows the TV (mirrored); release it when done. Never commit the token.
- Codex can't run: the model in ~/.codex/config.toml isn't supported. Don't edit that config.

## 2026-11-22: "Screening room" redesign (Concept 03 mockup)

Goal: apply the owner's Concept 03 mockup to web (incl. phones) and TV. Owner skipped Watchlist, Search, Settings, Profile.

Done:
- Backend: import stores poster_path, backdrop_path, overview (German) and German flatrate providers (title_tags kind 'provider'; channel/ad/kids variants dropped). Existing DBs migrate via ALTER in ensureSchema. Deployed to rei3 and imported (27 titles, all with posters). 23 tests pass.
- Web (frontend/index.html): rewritten. Cream/red/serif look, hero per view with backdrop, All/Cinema/Streaming chips, services select, genres/keywords panel, calendar grouped by day (each cinema/streaming release is its own entry), poster cards with Play trailer (modal <video> on /api/stream, no YouTube embed any more) and Request via Seerr; gate decisions moved into a "Trailer check" details. Responsive, checked at 375px (no horizontal scroll). Deployed.
- TV (tv-app/index.html): dark hero for the focused poster (backdrop, title, date + where, synopsis, Play trailer / Request via Seerr), poster rows below (one row for calendar/trailers/recent/all, a shelf per genre). Up from a poster -> Play; Down from hero -> that poster. View logic copied verbatim from the web page. Previewed in browser via .claude/launch.json (python http.server on 8765).

Next:
- Install the TV app on the TV (ask the owner first) and check with them.
- Commit + push; log progress on OctoSprout tasks OS-T-DV0WN (data), OS-T-2ADN0 (web), OS-T-34KA0 (TV).
- Pending owner approvals: OS-PROP-P6WJY (fallback in ADR OS-D-51H34).
- Poster wall (second mockup, OS-T-C7J65): web grid/list toggle (localStorage reelradar.layout) with badge tiles + detail dialog, deployed; TV Wall/Rows header button with info bar, checked in the 1920x1080 browser preview. TV app still not installed on the TV (waiting for the owner's OK).

## 2026-11-22 (afternoon): lead session, subagents per OctoSprout task
- Merged to main and pushed: OS-T-YDZXA (poster stretch, done), OS-T-Z2KE8 (Seerr lookups bounded, request button always offered), OS-T-2K6ZX (service chip counts match the view; pre-premiere signal is a follow-up task), OS-T-VP0FG (HEVC transcode + background reprocess; KinoCheck ident cutting is OFF unless `KINOCHECK_TRIM=1`), OS-T-BMGS7 (German synopsis fallback with `overview_lang`, ADR OS-D-TMAG1), OS-T-8568R (TV player progress bar and play/pause indicator).
- Deployed to rei3 (rsync of backend/ frontend/ docker-compose.yml README.md, then `docker compose up -d --build`) at main 065c989: live `/api/seerr` returns 200 for all 620 titles; background HEVC reprocess of 414 cached trailers (12.0 GB before) is running. NOT yet deployed: OS-T-BMGS7 and OS-T-8568R changes, and the synopsis needs a re-import (wipes and rebuilds the catalogue with the production TMDB key; ask the owner first).
- TV: `sdb connect` fails until `sdb kill-server && sdb start-server`. Build/install: `tizen package -t wgt -s hideki -o <dir> -- tv-app/` then `tizen install -n ReelRadar.wgt -s 192.168.42.54:26101 -- <dir>`.
- Owner tests on the TV: Seerr request works, seeking works. Open: web-page request, wall info bar, HEVC check on trailers, DE badge, progress bar on the TV.
- KinoCheck ident detector: blackdetect is unreliable on real files (Gatto xfPj0tSu7OM: intro logo 0-3 s then black 3.09-3.38 s; outro is a hard cut at ~144 s to a static red card with no black). A subagent is building a safer detector; keep `KINOCHECK_TRIM` off until it is checked.
- Task follow-up for the pre-premiere service signal exists in OctoSprout.

## 2026-11-22 (evening): KinoCheck detector deployed
- Main e35f838 (backend/kinocheck.js signature detector) is deployed to rei3 and `KINOCHECK_TRIM=1` is set in ~/reelradar/.env. API 200 on :8180 (titles, seerr). BMGS7 and 8568R backend/web parts are live too.
- Background reprocess is working through the cached files; Gatto (xfPj0tSu7OM) was still H.264 and uncut at deploy time, so it is trimmed only when its turn comes. Files that are already HEVC are not re-trimmed.
- Still open: German-synopsis re-import (needs owner OK), installing tv-app on the TV (TV was off), owner checks of progress bar, DE badge, HEVC playback.
- Re-import on rei3 done (625 titles): empty synopses 87 -> 17, 73 titles with `overview_lang='de'`. Gatto (xfPj0tSu7OM) was processed by hand (`media.processFile(path, true)` in the container): HEVC, 142.1 s, trimmed. Reprocess of the rest continues in the background.

## 2026-11-23: wall dialog, pre-premiere services, series, GPU transcoding
- Done and on main: OS-T-ZDB3G (TV wall long press, done: a 600 ms timer from the first OK keydown, e38b85d), OS-T-3HXMY (`provider_expected` from the DE digital release note, d3bfbfe, live; 22 of 42 upcoming digital titles have a service), OS-T-J0NCM (series, 19a6a84, live on rei3; import gave 730 titles, 105 series; Seerr season 1 only verified live with Tulsa King; Series badge checked on web and TV; series trailer play check open).
- Why series trailers hung on first play: uncached trailer = download + libx265 behind a 60 s proxy timeout (504), and 4 cores are shared with the background HEVC reprocess. Fix in progress: `node prefetch.js` running on rei3, plus GPU transcoding.
- GPU (owner OK'd): rei3 has a GTX 1660 SUPER (NVENC HEVC) and an old Haswell iGPU (no HEVC encode). Backend image moved from Alpine to node:24-bookworm-slim because NVIDIA libs are glibc-only; compose reserves the nvidia device with capability `video` and sets `HEVC_ENCODER=nvenc`. media.js encodes with hevc_nvenc (p5, vbr, cq 27) and falls back to libx265 on any failure. Verified in a scratch image on rei3: hevc_nvenc present, test encode gives hevc/hvc1, yt-dlp runs. 90 backend tests pass. NOT yet committed or deployed at the time of writing.
- Next: commit and push, deploy backend + docker-compose.yml to rei3 (`up -d --build`), check `docker compose logs backend`, time `/api/stream/tv/153312`, watch GPU use with nvidia-smi, play a series trailer on the TV, then close OS-T-J0NCM. Tidy: scratch image `rr-gpu-test` and ~/rr-gpu-test on rei3. Reinstall of the TV app is not needed for this.
- Note: `reelradar.db.pre-series` in the data volume is a copy without the WAL, so treat it as rough.
