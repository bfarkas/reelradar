# KinoCheck as primary trailer source: research (OS-T-BJ0F5)

Retrieved 2026-11-21. Live API calls: ~25 unauthenticated GETs to api.kinocheck.com, 1 s apart, no key, no account. Raw JSON not committed.

## Verdict
Usable only as a **candidate/secondary** source, not as sole primary for original-language-only playback. Free, keyless, TMDB-id lookup works, YouTube-embed ids are returned. But (a) the `language` label is a *query-language bucket* (de/en), not an original-audio label; (b) it has no `original_language`, no region, no dub/sub flag; (c) coverage of non-English originals is thin (4 of 10 sampled titles return zero videos). The ADR's fail-closed design is the right call, but KinoCheck can only ever supply "en" or "de" candidates, so for ko/fr/ja/es originals the KinoCheck label cannot equal `original_language` and TMDB `iso_639_1` must be the deciding signal (or an allow list).

## 1. API access
- Base `https://api.kinocheck.com/`, GET. Source: https://api.kinocheck.com/ (retrieved 2026-11-21).
- Auth: optional. Header `X-Api-Key` + `X-Api-Host: api.kinocheck.com` only if you hold a key. VERIFIED: keyless calls return HTTP 200. (A web-search summary claimed a key is required; contradicted by live calls.)
- `GET /movies?tmdb_id=|imdb_id=|id=` (exactly one), `GET /shows?...` (same; no season info), `GET /trailers?tmdb_id=...`, `/trailers/trending`, `/trailers/latest`. Params: `categories` (Trailer, Teaser, Clip, Featurette; `-` prefix excludes), `language` (de|en), `limit` (default 25, max 100), `page`, `genres` on /trailers.
- Only tmdb_id lookups were exercised live; imdb_id is documented, UNVERIFIED live.
- Responses carry `Cache-Control: max-age=3600` (Cloudflare). Cache accordingly.

## 2. Limits / pricing
1,000 requests/day per client; higher limits via API key on request; API free, custom/large-scale on request (https://api.kinocheck.com/). Exact key-registration process UNVERIFIED (not attempted).

## 3. Attribution
FAQ: "you must still link us as a source" (https://kinocheck.com/contact, 2026-11-21). No formal API terms page found (kinocheck.com/terms is 404; llms-full.txt https://kinocheck.com/llms-full.txt has no terms). Each trailer has a `url` on kinocheck.de/.com to link to.

## 4. Embedding
FAQ: embedding is allowed "as long as you embed the YouTube player and do not upload the video yourself" (https://kinocheck.com/contact). API gives `youtube_video_id` -> use standard YouTube embed. No own player. Non-commercial/self-hosted use not explicitly addressed; commercial use unaddressed. No written ToS for API found: UNVERIFIED legally, practical risk low for LAN use. API excludes content with third-party claims (api docs).

## 5. Language/region fields
- `language`: only `de` or `en` observed/documented. Docs say it sets title language and spoken language of videos, default `en`. OBSERVED: with no `language` param the API returned `de` (titles German, German-dubbed trailers) for all 10 samples, so do NOT rely on the default; always pass `language=en` explicitly.
- No `region` field in the live API response (the `region` US/GB/INT, `is_official`, `trailer_type` fields appear only in llms-full.txt feed descriptions, not in api.kinocheck.com output). No `original_language` in response. `original_title` is present on some titles only.
- `categories` values seen: Trailer, Teaser Trailer, Clip, Original, Special, Compilation, Talk.
- Real trailer shape (GET /movies?tmdb_id=496243&language=en, videos[0]):
```json
{"id":"ma5l","type":"video","youtube_video_id":"CMvEWm5FYHc","youtube_channel_id":"UCLRlryMfL8ffxzrtqv0_k_w","youtube_thumbnail":"https://img.youtube.com/vi/CMvEWm5FYHc/maxresdefault.jpg","title":"PARASITE Trailer (2019)","url":"https://kinocheck.com/trailer/ma5l/parasite-trailer-2019","thumbnail":"https://cdn.kinocheck.com/i/ekm7zad2kt.jpg","language":"en","categories":["Trailer"],"published":"2019-08-15T12:54:53+02:00","views":125238,"main_genre":"Thriller","genres":["Thriller","Drama","Komödie"]}
```
Movie wrapper: `id,type,tmdb_id,imdb_id,language,title,original_title?,release_year,release_date,url,trailer,videos[],recommendations[]`. Shows wrapper has no release fields. `trailer` can be null.

## 6. Coverage sample (language=en; default call returned de-dubbed trailers for the same ids)
original_language is from my knowledge of the titles, not returned by KinoCheck.

| Title (TMDB id) | Orig lang | videos (en) | videos (default = de) |
|---|---|---|---|
| Parasite (496243) | ko | 1 Trailer en ("PARASITE Trailer (2019)") | 1 Trailer, "German Deutsch" |
| Squid Game tv (93405) | ko | 5 Trailer + 1 Original, all en | 8, all "German Deutsch" |
| Anatomy of a Fall (915935) | fr | 0 | 1 German-labelled |
| Godzilla Minus One (940721) | ja | 3 en (2 Trailer, 1 Compilation) | 2 de (one "German Deutsch UT" = subtitled) |
| Decision to Leave (705996) | ko | 0 | 2 German-labelled |
| Society of the Snow (906126) | es | 0 | 0 (trailer null) |
| All Quiet on the Western Front (49046) | de | 0 en (title returned in English) | 1 de ("German Deutsch") |
| Dark tv (70523) | de | 4 en Trailer ("DARK Trailer (2017) Netflix") | 7 de |
| Money Heist tv (71446) | es | 1 en | 3 de |
| Spirited Away (129) | ja | 0 | 0 (trailer null) |

Findings: 4/10 return no `en` video, 2/10 nothing at all. For German originals (Dark, All Quiet) `de` is the original language, yet the "de" trailers are labelled "German Deutsch": for Dark that is plausibly original audio, for All Quiet uncertain. The `en` bucket for ko/ja/es shows may be original audio with English subs or an English dub: the label cannot tell. Titles do not say "dubbed"; only a "UT" (Untertitel) marker occasionally. No `ko/fr/ja/es` value ever appears.

## 7. TMDB iso_639_1 as second signal
Needed, yes. KinoCheck provides no original-language-audio signal, so TMDB `/movie/{id}/videos` `iso_639_1` plus title `original_language` is the only structured check. Caveat: TMDB video `iso_639_1` is also an uploader-chosen label, not verified audio. UNVERIFIED here (TMDB not queried; needs a key).

## ADR flags
1. KinoCheck language is only de/en: "label equals original_language" can pass only for en/de originals. For ko/fr/ja/es it will always fail, so KinoCheck would contribute nothing under a strict AND rule. Under OR rule, an `en` label on a Korean title is not evidence of original audio.
2. Default (no `language`) returns German dubs: must always send `language=en`; a missed param plays German dubs.
3. Thin non-English coverage (fr, ko, es, ja films had zero results).
4. No dub/localised flag; only title text heuristics ("German Deutsch", "UT"), brittle.
5. No region field; a US/GB/INT check cannot be done.
6. Allow/deny list will have to carry much of the load for non-English originals; consider TMDB videos as primary candidate source and KinoCheck as supplement.
7. No written ToS/API terms; attribution link required per FAQ; 1,000 req/day cap (fine for LAN with caching).
8. Docs vs. behaviour inconsistencies (keys "required" vs optional, region fields only in llms-full.txt): re-verify before building.
