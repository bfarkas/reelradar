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
