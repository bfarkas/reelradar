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
