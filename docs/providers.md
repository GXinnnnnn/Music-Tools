# Public metadata providers — 0.1.0

`source/core/providers.cjs` is a dependency-free CommonJS module for Electron's main process. `provider-adapters.cjs` implements QQ, Kuwo and VGMdb alongside the NetEase, iTunes and MusicBrainz adapters. Public requests use global `fetch`, with no login, API key, local proxy or Python service. Local audio is never uploaded.

## Selection and field policy

The desktop defaults to **QQ Music, then NetEase**. Optional platforms are iTunes, Kuwo Music, MusicBrainz and VGMdb. Equivalent matching evidence uses platform order as a tie breaker; QQ never outranks a materially stronger candidate simply because it is QQ. VGMdb supplies album metadata/artwork, not verified recording identity; album composers are not substituted for track artists.

Each metadata row has independent **sync** and **overwrite** controls, shared by single-song and batch completion. Enabled overwrite replaces an existing value; disabled overwrite fills only empty values. Existing user drafts count as current content. Unchecked fields cannot be staged even if a provider returns them. Unchecked local metadata is excluded from search conditions and ranking evidence; the filename still identifies the song. Duration remains technical recording evidence. A provider's missing or blank value never clears an existing field. The cover+artist+album preset selects exactly those three fields.

The main process independently enforces this policy in `source/core/sync-policy.cjs`, before searches and again before drafts are returned. Fill-only rows with no missing selected fields are skipped without a provider request. An explicit empty field selection or source selection makes no requests. Lyrics, detail and cover requests are omitted when their fields are unnecessary. Only staging downloads a selected cover; identical cover URLs are shared within a batch.

## Interface

```js
const { search, enrich, scoreCandidate, rankCandidates } = require('./source/core/providers.cjs');
const controller = new AbortController();
const options = {
  sources: ['qq', 'netease'],
  fields: ['cover', 'artist', 'album'],
  country: 'JP',
  local: { filename: 'First Love - 宇多田ヒカル.mp3', duration: 257 },
  signal: controller.signal
};
const { candidates, errors } = await search('First Love 宇多田ヒカル', options);
const tags = candidates.length ? await enrich(candidates[0], options) : null;
```

`search(query, options)` resolves `{ candidates, errors }`. Omitted sources defaults to QQ and NetEase; an empty array makes no requests. Unknown sources produce `UNKNOWN_SOURCE`. An empty or >500-character query rejects. Manual queries remain authoritative. MusicBrainz artist/title qualification applies only when both eligible local fields are contained in the query.

Candidates contain `id, source, title, artist, album, albumArtist, year, track, disc, genre, duration, coverUrl, url, score`. IDs are namespaced. Text uses `''` for unknown values, numbers use `null`, duration is seconds. MusicBrainz can include release IDs; VGMdb can include album metadata. Preserve IDs for enrichment.

`enrich(candidate, options)` returns the candidate plus available `artwork, lyrics, syncedLyrics, plainLyrics, translatedLyrics, errors`. Artwork fields contain remote URLs rather than embedded images. Lyrics prefer timed LRC. NetEase translations are retained when available, and instrumental recordings may have `instrumental: true`. `{ artwork: false }` and `{ lyrics: false }` also disable those request groups. Artwork or lyric failures retain usable metadata and produce visible partial errors.

## Ranking and filename interpretation

`scoreCandidate(local, candidate)` returns 0–99 using normalized Unicode title, artist, album and duration, with weights 55/30/10/5. CJK text uses character bigrams. Contradictory live/tour, instrumental/karaoke or remix/demo labels each subtract 12 points in either direction. Filename-only and title-only matches cap at 70; artist+title without album/duration caps at 94. `rankCandidates` orders by uncapped evidence before applying the display ceiling. A score is not proof of identity.

Filename hints support song–artist, artist–song and song–artist–work, including single-word bands. Ambiguous direction is corroborated against provider title/artist fields. Whole hyphenated titles such as `Spider-Man` remain intact. Track prefixes and duplicate-copy suffixes are removed from queries only; filenames are never changed by matching. A film suffix is not treated as reliable album metadata. No acoustic fingerprinting is performed.

Automatic filename queries may retry bounded, deduplicated simpler hints. Explicit manual queries are never rewritten. Batch search requests up to 50 candidates per source, ranks the combined pool, and displays the best eight per file. Title+duration without artist evidence remains unchecked for review. Users can change candidates and check individual rows before staging.

## Request efficiency and limits

- `signal`: cancellation rejects `AbortError`, including queued/retry/body waits. One cancelled subscriber does not abort another subscriber sharing a request.
- `timeoutMs`: default 10,000 per request/body, constrained to 100–30,000.
- `retries`: 0–2, default 1. Only network errors, timeouts, 429 and 5xx retry. Retry-After caps at five seconds; otherwise backoff starts at 500 ms.
- `limit`: per-source result limit, default 20, maximum 50.
- `country`: iTunes storefront, default CN, then JP and US when empty; duplicate storefronts are removed.
- `cacheTtlMs`: in-memory bounded caching of equivalent responses; failed requests are not retained. Keys include request URL, response format and selected fields. `0` disables reuse, useful for deterministic tests. In-flight requests are deduplicated.
- `fetch`, `throttleMs`: test injection points. Caches isolate different injected fetch functions.

Requests are spaced per hostname: MusicBrainz/VGMdb 1,100 ms; QQ/NetEase/Kuwo/Cover Art Archive 350 ms; iTunes/LRCLIB 250 ms. Response bodies are bounded to 4 MiB. Artwork downloads separately validate real image bytes and bounded sizes. No unlimited retry or hidden local server is involved.

Errors include `BLOCKED`, `RATE_LIMITED`, `TIMEOUT`, `NETWORK`, `NOT_FOUND`, `HTTP_ERROR`, `INVALID_RESPONSE`, `RESPONSE_TOO_LARGE`, `UNKNOWN_SOURCE` and `PROVIDER_ERROR`. A failed provider does not hide other candidates. Empty successful searches remain empty. Missing artwork/lyrics is surfaced, not invented.

## Public endpoints

- QQ: `c.y.qq.com/soso/fcgi-bin/client_search_cp`, `c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg`, artwork on `y.gtimg.cn`.
- NetEase: `music.163.com/api/search/get`, `/api/song/detail/`, `/api/song/lyric`.
- iTunes: `itunes.apple.com/search`, with 1200px artwork variants.
- Kuwo: `search.kuwo.cn/r.s`, `artistpicserver.kuwo.cn/pic.web`, `www.kuwo.cn/openapi/v1/www/lyric/getlyric`. The legacy single-quoted search response is parsed as bounded data, never evaluated as code.
- MusicBrainz: `musicbrainz.org/ws/2/recording/` JSON search.
- Cover Art Archive: release and release-group image listings, preferring front-cover 1200px URLs.
- VGMdb: the public `vgmdb.info/search/{query}?format=json` / `album/{id}?format=json` bridge. The official website is not bypassed when it blocks access.
- LRCLIB: exact `/api/get`, then `/api/search`; fallback requires title and artist agreement and duration within 15 seconds when available.

## Real network verification, 2026-10-30

`node scripts/providers-live-check.cjs` records all six independent results in `artifacts/providers-live-check.json`. This is a connectivity record, not a guarantee of matching accuracy.

| Platform | Actual observation |
| --- | --- |
| QQ | 晴天 / 周杰伦 / 叶惠美, 2003, 269s; cover URL and 1,388 lyric characters; no errors. |
| NetEase | First Love / 宇多田ヒカル / First Love, 1999, 257.893s; cover URL and 1,127 lyric characters; no errors. |
| iTunes JP | First Love candidates, 1200px artwork URL. LRCLIB returned HTTP 503 during this probe; retained tags/artwork. |
| Kuwo | Search and artwork returned; the top result was a 15-second excerpt. Missing timed lyrics and LRCLIB 503 were reported. Candidate review is necessary. |
| MusicBrainz | Search returned recordings and Cover Art Archive returned artwork. An unrelated spoken-word result ranked first without supplied local identity; review/local evidence is necessary. LRCLIB returned 503. |
| VGMdb | HTTPS bridge disconnected before TLS establishment. HTTP bridge also closed the connection. Official `vgmdb.net/search` returned a 403 challenge. Adapter remains selectable with a visible error; live retrieval could not be verified on this network. |

Earlier real checks also obtained LRCLIB timed lyrics and original MusicBrainz recordings. Availability varies and no failed service is represented as working.

Deterministic coverage: `node --test tests/*.test.cjs` (105 passing across the project), including provider adapters, safe legacy parsing, field gating, priority ties, shared cache/cancellation, filename identity, retries and limits. `node scripts/ui-policy-check.cjs` additionally stages and writes selected fields to eight real disposable audio copies and verifies every other tag is unchanged. The opt-in historical live smoke remains available via `MUSIC_TOOLS_LIVE=1 node --test tests/providers.live.cjs`.
