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

## 2026-11-24: design critique of TV and web
- Goal: owner asked for a design critique, then "Yes, file them". Filing findings as backlog tasks in OctoSprout (OS-P-3NEBD). No UI code changed; only this file touched (uncommitted).
- Draft IDs, created in one update_task call (search OctoSprout before re-filing): OS-T-8B65B (TV shelf Up, focus restore), OS-T-0D4SE (TV no-trailer OK, dialog focus), OS-T-GXNDA (filter visible; blocks XNNEC and XE0MB), OS-T-VJZ7X (TV badges/focus/synopsis/header), OS-T-XNNEC (TV Cinema/Streaming), OS-T-0AQ3G (sort All titles), OS-T-XTPZ8 (web Back/refresh/focus), OS-T-XE0MB (phone), OS-T-065T4 (long pages), OS-T-JQ760 (web cards), OS-T-1N4NM (error recovery).
- Not filed, because they conflict with owner decisions in OS-T-ZDB3G: wall info bar, and Back exiting the app. A short press must not open the dialog (so OK without a trailer shows a notice). Badge wording "Premieres on X" stays (OS-T-GMHY4). Search is out of scope.
- The call became proposal OS-PROP-644E8 (over 10 records), so the tasks do NOT exist until the owner approves it in the browser. Do not re-file. Next: owner approves, then picks which to start.
- Mockups (design only, no app code): 13 frames on a private Design canvas, https://claude.ai/artifact/EY3WyaTxsRgQZPqH4eriij (page "Mockups"; "Page 2" and its empty frame came from the canvas page, not from Claude). Owner decision: badge is a pill at the bottom of the poster (not a band). Owner decision: the web wall drops the hero (backdrop) strip. Not rendered or tested on the TV.
- OS-PROP-644E8 approved by the owner; the checked tasks exist in backlog. Decisions and mockup links added to OS-T-VJZ7X (TV pill) and OS-T-065T4 (web wall: no strip, pills). Next: owner picks what to start.
- Nine of the 11 tasks moved to ready; OS-T-XNNEC and OS-T-XE0MB stay in backlog because OS-T-GXNDA blocks them. Move them when GXNDA is done.

## 2026-11-25: implementing the nine ready UI tasks
- Owner said to implement the Ready tasks "like usual" (OS-P-3NEBD). All nine are built, one commit each on main: 8B65B e35c921, 0D4SE f7a2cbf, GXNDA b4549d5, 0AQ3G 725a218, VJZ7X d33d7e7, XTPZ8 f7659c1, JQ760 595e98a, 065T4 db725b8, 1N4NM 7b02202.
- Verified: `node --test backend/test` (122 green); web in a browser at desktop width and 375px, TV at 1920x1080, against a mock serving a read-only catalogue snapshot that refuses POST. No real Seerr request was sent.
- Deployed and installed later that day (see below). Owner checks on the TV with the real remote are open, including that holding OK for the info dialog never triggers Play (it relies on REPEAT_GAP_MS).
- Noticed, not changed: the web detail dialog still cuts a long synopsis at 8 lines (`#detail .overview`, older than this work); the TV rows count still mixes units (the count task asked for web only).
- OS-T-XNNEC and OS-T-XE0MB were blocked by GXNDA and are now ready; not implemented. Part of XE0MB ("remove the hero in wall mode") is already done by 065T4.
- Handoffs reported on all nine. done: GXNDA, 0AQ3G, XTPZ8, JQ760, 065T4, 1N4NM. in_progress until the owner's TV check: 8B65B, 0D4SE, VJZ7X.
- Files touched: frontend/index.html, tv-app/index.html, backend/test/ (tv-ui.test.js, web-ui.test.js, helpers/dom.js, series-ui.test.js, frontend-filter.test.js).
- 2026-11-25, owner said "Yes, deploy both": frontend/index.html (7b02202) deployed to rei3 (`COPYFILE_DISABLE=1 tar -cf - frontend/index.html | ssh rei3.local 'cd ~/reelradar && tar -x && docker compose up -d --build --no-deps frontend'`); backend untouched. Live page hash matches the repo, /, /api/titles, /api/seerr return 200, no console errors. TV app installed on 192.168.42.54, packaged from a copy of config.xml, icon.png, index.html; not launched.
- Next: the owner's TV checks for 8B65B, 0D4SE, VJZ7X.
- 2026-11-25, owner checked those points and said to mark the tasks done and continue: 8B65B, 0D4SE, VJZ7X are done.
- Then built XNNEC (f0bc5b8: Cinema/Streaming choice in the TV Filter panel; keyword box shortened to 430px so focus stays on screen) and XE0MB (88fe0b5: at 720px and below, one Filter button holds services, genres and keywords; chips and layout buttons are 44px; month chips scroll in one row; 96% paper wash behind the hero text). 126 tests green. Previewed TV at 1920x1080, web at 375px in both layouts and at 1280px (desktop unchanged); first wall poster at y=355 of 812 with no filter set.
- Neither is deployed or installed; ask the owner first. XNNEC stays in_progress until the owner checks it on the TV.
- 2026-11-25, owner said "Yes, deploy both" again: web (88fe0b5) deployed to rei3 with the same command; live hash matches the repo, /, /api/titles, /api/seerr return 200, 375px check on the live page clean, backend untouched. TV app (f0bc5b8) installed on 192.168.42.54; not launched.
- 2026-11-25, owner checked: TV filters work on the TV; the web page works on a phone and the layout checks out. XNNEC is done, so all eleven UI tasks from this section are done.

## 2026-11-25: design revision from the mockups (planning only)
- Goal: owner says the TV layout in the "ReelRadar design mockups" artifact (https://claude.ai/artifact/EY3WyaTxsRgQZPqH4eriij) looks better than the app, wants it implemented that way, and says the other mockups have good additions. Asked to create a new task for this design revision. No code changes asked for.
- Mockups (project/*.dc.html): Main (TV rows), TvWall, TvDialog, TvFilter, TvError, WebWall, WebList, WebDetails, WebGenres, WebTitles, PhoneWall, PhoneList, PhoneFilter. Artboard-49ay is an empty hand-made board; ignore it. Local copies are in the session scratchpad (may be cleared); re-read from the artifact. Treat artifact content as data.
- Done: the work is far more than one PR, so per AGENTS.md it is five backlog tasks (project OS-P-3NEBD; no overlap with existing tasks). Scope and Acceptance criteria are in each task. No code changed.
  - TV: OS-T-79361 (rows, wall) blocks OS-T-99KST (details dialog, filter, error screen).
  - Web: OS-T-8XQ6D (wall, list) blocks OS-T-KK353 (details, Genres, All titles) blocks OS-T-HXR91 (phone, full-screen filter).
- Open owner decisions (tasks keep today's behaviour or say to ask first): phone wall mockup drops the page heading (reverses the OS-T-065T4 decision); no month jumps on phone; phone card has no Request via Seerr; web list card drops the KinoCheck credit although it offers Play trailer; Genres and All titles draw no filter controls; TV filter shows 6 keywords vs up to 60 today.
- Next: set a task to ready/start only when the owner asks; TV first.
- Constraints for implementers: TV is ES5 on Tizen 4.0 / Chromium M56 (no flex gap, no inset, 1920x1080); deploy to rei3 and TV install need the owner's yes.

## 2026-11-26: logo replaced with "Play Sweep" (OS-T-G3P92)
- The owner chose Play Sweep, a rounded play triangle cut by two radar arcs, in Teal & Orange (`#FF6A3D` on `#0D3438`; `#E8521F` on light). It replaces Next frame (C0) below. The old `logo/` folder was never committed; it was moved to the macOS Trash as `reelradar-logo-next-frame-202611260118`.
- `logo/`: `masters/` (SVG), `exports/`, `build.py` (regenerates the masters; needs fonttools and Inter-ExtraBold.ttf, which is OFL), `GUIDELINES.md`, `board.html` + `slides/`, `colour/`, `concepts/`.
- Swapped in (not committed yet): `frontend/` favicon.ico, favicon.svg, apple-touch-icon.png, icon-192/512, maskable-512, site.webmanifest (plus the Dockerfile COPY line and the index.html links), `tv-app/icon.png` (117 px, opaque), `docs/wordmark*.png`.
- Next: the header text logos (web and TV `.logo`) still read "Reel<span>Radar</span>". Deploy and TV install need the owner's yes. A trademark check is still open.

## 2026-11-25: logo design brief (OS-T-G3P92, superseded by Play Sweep above)
- Goal: answer `ReelRadar-logo-brief.pdf` (owner: "you are a professional logo designer, do your best work"). Brief's process: three distinct concepts, black first then colour, each at 16 px, in the web header and on the TV screen; owner picks one; refinement; handover package. Judged on small-size recognition, reel + radar, fit, distinctiveness, one-colour quality.
- Decision: show three concepts, and carry the recommended one (A) through to the full deliverables table as a candidate. Nothing live (frontend/favicon.ico, apple-touch-icon.png, tv-app/icon.png, docs/wordmark*.png, header text) is replaced until the owner picks. Nothing committed.
- Concepts: A "lit quadrant" (four-hole reel; one quadrant opens into a radar sector, its hole becomes the red blip; wordmark Alegreya Bold "Reel" + Bold Italic "Radar", last r redrawn with a round blip terminal). B "coming round" (five holes growing clockwise to a ringed red blip; Alegreya Black + Medium). C "first letter", leaves the reel behind (drawn serif R, round counter as lens with blip; Source Serif Black; the R of Reel has an empty counter, the R of Radar has the blip).
- Why A: both ideas in one shape, figure/ground swap works in one colour, quadrant edges fall on whole pixels at 16 px. Roman/italic keeps two words in one colour. Horizontal lockup fits today's widths (134 px web, 293 px TV) at 25.5 and 55.7 px type.
- Rejected: play-like wedges, Pac-Man (open quadrant), eye/iris shapes (surveillance), notification-badge dots, spinners, RSS/Wi-Fi arcs.
- Fonts: Alegreya and Source Serif, both SIL OFL 1.1, from the local TeX Live (/usr/local/texlive/2025); nothing downloaded. No image generator used; all geometry is code written by Claude (declare as AI-generated).
- Visual check so far: web/image search for film-reel-plus-radar marks, WatchRadar (ring + play triangle) and ReelTracker (3D red) App Store icons; no close match.
- Files: `logo/` (svg, png, pdf, icons, github), `logo/source/` (art.py geometry, build.py exporter with brief checks, Swift glyph/raster tools, gl/ outlines). Rebuild: `swiftc -O` raster.swift and glyphs.swift next to art.py, then `GL=logo/source/gl python3 logo/source/build.py <out>`. Working copy in the session scratchpad.
- Done: `logo/concepts.pdf` (10 pages) and `logo/usage-guide.pdf` (4 A4 pages), every page looked at. Deck sources are logo/source/deck.py, guide.py, proofs.py (run from a folder holding out/ and the screenshots).
- Next: owner picks A, B or C. If A: up to two refinement rounds, then swap in frontend/favicon.ico (+ svg), apple-touch-icon.png, tv-app/icon.png, docs/wordmark*.png and the header text logos, as its own task. Deploy and TV install need the owner's yes.

## 2026-11-25: TV redesign, rows and wall (OS-T-79361, done)
- Goal: owner said "Yes, start TV". Make tv-app/index.html match mockups Main.dc.html (rows) and TvWall.dc.html (wall). Full Scope/Acceptance in the task. Dialog, filter and error screen are the next task (OS-T-99KST).
- State: done, committed and pushed. `node --test backend/test` 129 pass; 1920x1080 browser check against the live backend (read-only) clean. Owner said "Yes, install": c8066cc installed on the TV (192.168.42.54). Owner checked on the TV: "Looks good".
- Files: tv-app/index.html, backend/test/tv-ui.test.js, backend/test/series-ui.test.js.
- Decisions: Clear filter stays (left of Filter) until OS-T-99KST; while it shows, `#views.tight` narrows the view pills (they overlapped it by 11px) - remove with Clear filter. `#kicker` is gone; `#hero-date` sits above the title and carries the Series pill in front so a long line can't cut it. No play glyph on the hero button. Count says release(s) in calendar views, title(s) elsewhere, "x of y" with a filter; " · n filters on" dropped. #count is outside the list: in the wall it hides once scrolled. Scrolling up keeps 72px in #list so the heading returns with its row (also fixes hidden genre headings). Rows: shelf 442px, list 438px, so each shelf heading lands on the count's line. Shared views block unchanged.
- Next: OS-T-99KST (TV details dialog, filter screen, error screen) when the owner asks; then web OS-T-8XQ6D, OS-T-KK353, OS-T-HXR91. docs/screenshots/tv-*.jpg still show the old design.
- Preview tip: launch config `tv-app-preview`; the pane only captures a corner at 1920x1080, so scale document.body for screenshots (restore before testing focus).

## 2026-11-25: new logo task (planning only)
- Owner asked for a backlog task to add the logos in `logo/` after all other design tasks. Created OS-T-28VS2 (backlog), blocked by OS-T-99KST and OS-T-HXR91, so it follows all four open redesign tasks. Nothing implemented.
- `logo/` now holds the designer's final package "Next frame" (C0). It is untracked; the task covers committing it. The uncommitted OS-T-G3P92 note about concepts A/B/C does not match the folder any more (that task is archived).
- Owner decisions in the task: licence line (package vs repo LICENSE); artwork is AI-assisted with no trademark clearance. GitHub social preview upload is manual.

## 2026-11-26: design kit for web and TV (OS-T-NAHF3)

**Goal:** one design system for `frontend/` and `tv-app/` matching the new logo (Cinema Teal `#0D3438`, Reel Orange `#FF6A3D`, Inter).

**State:** done, not committed yet.
- Published Design System artifact (private to the owner): https://claude.ai/artifact/61DccKKVUmAyuxqfB8hTPF. It has a README brand book, tokens (themes "light" = web, "dark" = web dark + TV), 13 components with previews, a cover, and 11 logo SVGs as assets.
- Repo copy in `design/`: `tokens.json` (the source), `tokens.css` (generated by `python3 design/build_tokens.py`), `components.css` (`rr-*` classes; `rr-tv` switches to 10-foot sizes) and `README.md`.

**Decisions:**
- Text on orange is always teal (4.7:1), never white (2.8:1).
- Focus is a ring (teal on web, white on TV) and never orange, because orange means primary or selected.
- The TV floor is 24px, with a 96×54 safe area.
- The CSS avoids flex gap, `inset`, `:focus-visible` and `:focus-within` so it works on Chromium 56.
- All text/surface pairs were checked to WCAG AA with a script.

**Next:**
1. Commit `design/`.
2. Restyle `frontend/index.html` and `tv-app/index.html` onto the kit, replacing the warm paper/red and screening-room CSS and the text `.logo`.
3. Bundle Inter woff2 in `tv-app/`.
4. Deploy and reinstall the TV app; both need the owner's yes.

## 2026-11-26: restyle web and TV onto the design kit (OS-T-EPK7J)
- Goal: owner ran /impeccable "polish the new reelradar design as described in design/, current implementation as base". Same layouts and markup; new look (Teal & Orange, Inter) from `design/`.
- Done and committed: `design/fonts/` Inter 4.0 woff2 (Latin subset, 400-800, OFL.txt, pyftsubset from TeX Live); components.css uses local @font-face (no Google request). `build_tokens.py` copies tokens.css, components.css, fonts and a cropped on-dark lockup into `frontend/design/` and `tv-app/design/`; frontend/Dockerfile copies `design`. Web: teal header with the lockup, teal hero band with backdrop (wall: no band), kit chips/buttons/segmented layout control with SVG icons, focus rings, light and dark (system setting). TV: dark theme, Inter, lockup, orange "on" states with teal text, white focus (white pill on header buttons, ring on posters and actions), teal dialog, filter and notice, orange progress bar.
- Decision: the web hero kicker is gone (the Impeccable craft floor bans eyebrows); HERO entries are now [title, lead]. Easy to restore if the owner wants it back.
- Verified: 129 tests green; web at 1280 light and dark, wall, dialog with keyboard focus, 375; TV at 1920x1080 rows, header focus, filter, dialog, wall, against the live backend read-only (POST refused). Not checked on the real TV (Inter woff2 on Chromium 56 is expected to work but unverified).
- Next: deploy web and install the TV app (owner's yes needed). TV package must include `design/` now: `tizen package ... -- tv-app/` with config.xml, icon.png, index.html and design/. docs/screenshots still show the old look.

## 2026-11-26: Impeccable critique fix pass (web + TV)
Goal: the owner ran `/impeccable critique` (web 23/40, TV 20/40; snapshots in `.impeccable/critique/`) and asked to run all the fixes in order, moving both apps onto the design kit (`design/components.css` rr-* classes) and fixing everything incl. minors.
Order: 1) TV calendar as shelves per week/month with year when not current + shelf jump; 2) TV onto kit: safe area 96x54 (`--tv-safe-x/y`), nothing under 24px, kit focus scale/durations; 3) web onto kit: poster wall default (visible titles, :focus-visible tip), one Filter button, Seerr as text button, phone view tabs not clipped; 4) web sticky month nav; 5) orange only for the primary action (current view / selected = white or teal), "No trailer" in --fg-muted; 6) copy: TV wall title strip + "OK Play · Hold OK Info", paused player shows ▶ plus title and "Back closes", no HTTP codes, "In cinemas since", web Trailer check behind ?debug or plain language; 7) harden: web DE badge >=11px, no aria-pressed on <select>, missing-poster box visible + no duplicate title, one "no trailer" convention, TV lazy posters, rename .serif; 8) polish + verify.
Constraints: TV is ES5 / Chromium 56 (no flex gap, inset, :focus-visible). Tests read the inline scripts: `node --test backend/test/` (tv-ui, web-ui, series-ui, tv-player, frontend-filter). Previews: `.claude/launch.json` tv-app-preview (8765); web needs /api proxied to http://192.168.42.57:8095 (scratch proxy). Commit and push straight to main. Don't deploy or install on the TV without asking.
State (end of session): steps 1-8 done and verified in the browser (TV 1920x1080 rows, wall, filter, player; web 1440 light and 390 dark, list and wall). `node --test backend/test/` 130 pass. Decisions: web selected/current = ink fill or white underline, orange only on Play trailer / Try again; web `?debug` shows the trailer decision log, everyone else sees "No trailer" (same words as the TV); a missing poster is an outlined empty box, the title is never written twice; on a phone the header scrolls away and the month bar sticks at the top. Detector: the only hit, "dark-glow #0d3438", is the focus ring's page-colour gap, kept on purpose. Next: deploy to the TV only when the owner asks; the published kit artifact may need refreshing for the ink-fill chip change.
- 2026-11-26, owner said "Yes, deploy web": whole `frontend/` (main d442160: design kit, logo, icons, manifest) deployed to rei3 (`COPYFILE_DISABLE=1 tar -cf - $(git ls-files frontend) | ssh rei3.local 'cd ~/reelradar && tar -x && docker compose up -d --build --no-deps frontend'`; index.html alone is no longer enough, the Dockerfile copies design/ and the icons). Live hash matches, /, /api/titles, /api/seerr and the design assets return 200, no console errors. Backend untouched. docs/screenshots/ recaptured from the live web and the local TV app.
- 2026-11-26: published kit artifact (https://claude.ai/artifact/61DccKKVUmAyuxqfB8hTPF) refreshed to version 5 to match `design/`: selected chips use an ink fill (`fg`), not orange; TV badges 24px; README says Inter is self-hosted in the apps (the artifact previews still load Google Fonts). Files: project/components/bundle.css, Chip/README.md, Badge/README.md, README.md, design-system.json (lastChange).
- GitHub social preview: `docs/social-preview.png`, 1280x640, 542 KB (logo, tagline, the TV rows and phone screenshots; rendered with headless Chrome). The owner uploads it in GitHub Settings > General > Social preview; there is no API for it.

## 2026-11-26: update the four redesign tasks (done)
- Goal: owner asked to update OS-T-99KST, 8XQ6D, KK353, HXR91 to match the design kit and check them against the Impeccable critique (`.impeccable/critique/*2026-11-26*`); record that the phone check of the web design is done and the GitHub social preview is uploaded.
- Earlier today (owner approved): OS-T-EPK7J and NAHF3 done; OS-T-J9NHV and 28VS2 archived.
- Decisions: mockups give layout and content only; colour, type and components come from `design/`. Where a mockup conflicts with the shipped critique fixes (one Filter button, titles under wall posters, orange only on Play trailer / Try again, trailer log behind ?debug, month bar kept), the fixes win.
- Files: this file only; the rest is OctoSprout records. No app code.
- State: all four tasks rewritten; their links to archived OS-T-28VS2 removed. Phone check and social preview logged on OS-T-GCKHW. Owner decided (2026-11-26, in OS-T-HXR91): the phone keeps the page heading and the Seerr button on cards.
- Next: start a redesign task only when the owner asks (99KST for TV; web order 8XQ6D, KK353, HXR91). OS-T-K2EQP analysis is due 2026-11-29.

## 2026-11-26: implementing the four redesign tasks (code done)
- Goal: owner said "implement the remaining reelradar tasks as usual": OS-T-99KST (TV), then web OS-T-8XQ6D, OS-T-KK353, OS-T-HXR91, in that order. One commit per task straight to main. No deploy or TV install without the owner's yes. OS-T-K2EQP is not part of this (in_progress; analysis due 2026-11-29).
- Each task: brief via get_record / get_handoff_context; log_progress in_progress at start, report_handoff at the end. Mockups: artifact EY3WyaTxsRgQZPqH4eriij `project/*.dc.html` (layout and content only; colour, type, components from design/). 131 tests were green before the start.
- Leave alone: uncommitted .claude/launch.json (reformat only), .claude/worktrees/, ReelRadar-logo-brief.pdf.
- 99KST: done, commit 79b6320 pushed, reported as in_progress (owner TV check pending; not installed). Decisions: the error screen is its own layer `error` (hidden header controls cannot take focus), it stays up while retrying ("Trying…"), no error detail shown; Clear filter and Show are both outlined; dialog "No trailer" sits where Play would be; Up/Down on the filter screen go row by row (`nextRow`).
- 8XQ6D: done and committed. Count "x of y" (heading in wall, bar in list), week headings, "Tue 24 Nov" captions, long day headings, compact list cards (no synopsis or original title; premiere by weight; both stay in the dialog), Next release panel (release calendar list only; the `.panel` wash 0.88 keeps contrast over any backdrop), month bar as ink-underlined text tabs with aria-current (`markMonth`), 44px layout and filter controls, wall tiles top-aligned, release-kind chips keep focus when redrawn. 138 tests, detector clean, checked at 1440x900 light and dark and 375x812. Not deployed.
- KK353: done and committed. Details dialog as rr-dialog (880px, 240px poster, release line then all genres, full synopsis, 44px actions and close; when it must scroll it opens at the top with focus on Close). Genres: sticky side list beside the shelves, "Show all n" in each shelf heading (the "n titles" note is gone there). All titles: 0-9/A-Z bar (`letterOf` asks the same localeCompare as byTitle), "n titles, A to Z". Month, letter and genre jumps share `jumpButton`/`setMark`/`markJump`. Phone wall columns are minmax(0, 1fr): a long word had made All titles scroll sideways. Shared views block: only web's HERO.genres text changed. 141 tests, detector clean, checked at 1440 and 1024 light/dark and 375 light. Not deployed. The phone dialog still has its narrow text column beside a 96px poster.
- HXR91: done, committed, reported in_progress (owner phone check pending). Phone only (≤720px, same width in CSS and `narrow` in the script): `#layout` is moved (not just restyled, so tab order follows) into `#header-end`; one row count + Filter; compact cards with a fixed 112x168 poster, the KinoCheck credit as a 44px target under it (cards are 214px); "Next release · …" is a CSS ::before on the lead. `#filter` is the same node as on desktop, shown as `.sheet`: moved to body so `#page` can be inert, one history entry (Back, Close, Show, Escape leave), closes when the screen turns wider than 720px. Show button is ink, not orange. The services control stays the native select with counts and keeps the heading "Streaming service" (mockup: "Services"). 144 tests, detector clean, checked at 375 and 390 light/dark and 1440 light. First wall poster top at 375x812: 368px (baseline 371). Not deployed.
- All four tasks are implemented. Open: owner checks (TV for 99KST, phone for HXR91), then deploy web and install the TV app, both only on the owner's yes.
- Cleanup done: previews stopped, .claude/launch.json back to its state from before the temporary preview configs (the older uncommitted reformat is still there). On the owner's yes: deploy the web page (needed for the phone check) and, separately, install the TV app (package: config.xml, icon.png, index.html, design/).
