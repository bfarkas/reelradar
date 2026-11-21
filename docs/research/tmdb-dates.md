# TMDB German dates research (OS-T-FG3X9)

Run 2026-11-21 from rei3 (key never left the server; it is a v4 bearer JWT, sent as `Authorization: Bearer`). About 90 calls, 300 ms spacing.

## Verdict

TMDB `/movie/{id}/release_dates`, entry `iso_3166_1 == "DE"`, type 3 (theatrical) and type 4 (digital), is correct for the sampled titles. No DE entry means no date. Never fall back to US or global dates. For series, show "available on X in Germany" from `/tv/{id}/watch/providers` -> `results.DE`, not premiere dates.

## Movies: TMDB DE vs independent calendar

Sample came from `/discover/movie?region=DE&with_release_type=3` over 2026-09..2027-02, plus `/movie/{id}/release_dates`. Independent sources were WebSearch/WebFetch of kino.de, filmstarts.de, filmportal.de, cinestar.de and moviejones. The independent check was done for 9 of the 18 titles pulled; the others were read but not cross-checked.

| Title | TMDB DE | Independent | Match |
|---|---|---|---|
| Die Tribute von Panem: Sunrise on the Reaping | T3 2026-11-19 (T1 premiere 11-02) | 19.11.2026 (filmportal, filmstarts) | y |
| Avengers: Doomsday | T3 2026-12-16 | 16.12. (tvmovie, filmstarts expects it); pcgames says 17.12. | y (not officially confirmed) |
| Resident Evil | T3 2026-09-17, T4 2026-11-26, T5 2027-02-28 | cinema 17.09. (filmstarts, kino.de); digital 26.11. and Blu-ray 18.12. (kino.de) | cinema y, digital y, physical differs: TMDB 2027-02-28 vs kino.de 18.12. (the TMDB value is a "4K/Blu-ray/DVD" note entry, so not a reliable physical date) |
| Godzilla Minus Zero | T3 2026-11-05 | 05.11. (kino.de, pcgames) | y |
| Wie verhext | T3 2026-11-26 | 26.11. (filmstarts, most sources); one kino.de article says 27.11., search.ch 25.11. | y (sources disagree) |
| Der Kater mit Hut | T3 2026-12-10 | 10.12. (kino.de, cinestar) | y |
| Ebenezer | T3 2026-11-12 | 12.11. (all sources) | y |
| Hope | T1 2026-09-09 (Fantasy Filmfest), T3 2026-10-08 | 8.10. (Mubi); festival in the month before | y |
| Puella Magi Madoka Magica -Walpurgisnacht: Rising- | T3 2026-11-24 | 24.11. (kino.de, cinestar), limited Japanese OmU | y (limited run) |

Not cross-checked but read: Other Mommy T3 10-29; Beware Boiuna T3 11-12; Ramayana T3 11-05; I Play Rocky T3 11-26; Meine Frau, unsere Schwiegertochter und ich T3 11-26; Fjord T3 2027-01-07; Wicker T3 2027-02-11.

## Per-case rules

1. **DE type 3 present**: theatrical date is that value. If a title has several DE type 3 entries, use the earliest in the future, otherwise the latest past one.
2. **DE type 4 present**: digital date is that value. Type 4 is shown separately from type 3.
3. **DE date missing**: show "no German date" or omit. Examples of titles with no DE entry: Ghost Soldier (1562642), The Beast (1185344), A Story of Derry (1813355; DE absent, many other countries listed). Never use the US or global date. Types 1/2/5/6 are not substitutes (type 1 premieres and festivals are noise; type 2 is limited, e.g. "You Can See Everything" has DE T2 2026-11-19 "UCI" and T3 2026-12-03).
4. **Streaming-only titles**: the title has no DE type 3; availability comes only from watch providers (rule 5). Do not turn a streaming start into a theatrical date. A global `release_date` field on the movie object is not a German date either: Resident Evil shows `release_date` 2026-09-16 while DE is 09-17.
5. **Streaming (movies)**: `/movie/{id}/watch/providers`, read `results.DE` explicitly. The `watch_region` param does not filter: it returned 52 regions for Resident Evil and 8 for Other Mommy. `results.DE` was null for all three films tried (Resident Evil, Other Mommy, Panem), so null means "no provider data", not "not streaming". Provider data is JustWatch: JustWatch attribution is required (visible "Powered by JustWatch" next to this data) and TMDB attribution is required (logo plus the "This product uses the TMDB API but is not endorsed or certified by TMDB" text).
6. **Series**: see below.

## Series

- `/tv/{id}`: `first_air_date`, season `air_date` and `next_episode_to_air.air_date` are origin or first-release dates, not German dates (e.g. Dragon Ball Super: Beerus has first_air_date 2026-10-11 and season 1 air_date 2026-10-10, i.e. Japanese timing). There are no per-country air dates. `/tv/{id}` has `origin_country` and `original_language`; `/tv/{id}/content_ratings` is per country but has no dates.
- `/tv/{id}/watch/providers` returned `results.DE` with flatrate lists (Netflix etc.) for the four titles tried; `results` held 128-131 regions.
- `/discover/tv?watch_region=DE&with_watch_providers=8&with_watch_monetization_types=flatrate&first_air_date.gte=...` works for "what is on Netflix in Germany".
- **Approach**: no exact premiere dates. Show "available on {provider} in Germany" from `results.DE.flatrate`, optionally `first_air_date` labelled "first aired (origin)". Hide the line when DE is null.

## Videos, language, genres, keywords

- `/movie/{id}/videos`: each video has `iso_639_1`, `iso_3166_1`, `type` (Teaser, Trailer, Featurette, Behind the Scenes...), `site`, `key`. `iso_639_1` is usable as the language signal. By default results are mostly `en`; `?language=de-DE&include_video_language=de,null` still returned only `en` videos for the three titles tried, so German trailers are often absent. Filter on `iso_639_1` client-side and do not assume a German trailer exists.
- Title language: `original_language` on the movie and tv object (ISO 639-1, e.g. `en`, `ja`, `ko`).
- Genres: movie objects carry `genres: [{id, name}]`; `?language=de-DE` localizes names (Abenteuer). Lists: `/genre/movie/list?language=de`, `/genre/tv/list?language=de`. Note TV has combined ids (10759 Action & Adventure). Discover lists carry `genre_ids` only.
- Keywords: `/movie/{id}/keywords` returns `{id, keywords: [{id, name}]}`; names are English only (e.g. 'isolation', 'based on novel or book'). `/tv/{id}/keywords` returns `{id, results: [...]}` (key differs from movies).

## Caveats

- 9 of 18 titles independently verified; digital dates verified for only one title (Resident Evil).
- Independent sources came from search summaries, not full page reads (except the kino.de streaming article).
