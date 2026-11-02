'use strict';

// Public, credential-free services only. Request scheduling is shared across calls.
const USER_AGENT = 'MusicTools/1.0 (local desktop metadata editor)';
const SOURCE_NAMES = Object.freeze(['qq', 'netease', 'itunes', 'kuwo', 'musicbrainz', 'vgmdb']);
const DEFAULT_SOURCES = Object.freeze(['qq', 'netease']);
const SOURCE_CATALOG = Object.freeze(SOURCE_NAMES.map(id => Object.freeze({
  id, name: ({ qq: 'QQ音乐', netease: '网易云音乐', itunes: 'iTunes', kuwo: '酷我音乐', musicbrainz: 'MusicBrainz', vgmdb: 'VGMdb' })[id],
  search: true, metadata: true, cover: true, lyrics: ['qq', 'netease', 'kuwo'].includes(id),
  lyricsFallback: 'lrclib', albumOriented: id === 'vgmdb', default: DEFAULT_SOURCES.includes(id)
})));
const TAG_FIELDS = Object.freeze(['title', 'artist', 'album', 'albumArtist', 'year', 'track', 'disc', 'genre', 'composer', 'lyricist', 'comment', 'cover', 'lyrics']);
const fetchScopes = new WeakMap();
const MIN_INTERVAL = { 'musicbrainz.org': 1100, 'coverartarchive.org': 350, 'music.163.com': 350, 'itunes.apple.com': 250, 'lrclib.net': 250, 'c.y.qq.com': 350, 'search.kuwo.cn': 350, 'www.kuwo.cn': 350, 'artistpicserver.kuwo.cn': 350, 'vgmdb.info': 1100 };
function scopeFor(options) {
  const fetcher = options.fetch || globalThis.fetch;
  let scope = fetchScopes.get(fetcher);
  if (!scope) { scope = { cache: new Map(), inflight: new Map(), hostQueues: new Map(), nextAllowed: new Map() }; fetchScopes.set(fetcher, scope); }
  return scope;
}
function selectedFields(options) {
  if (options.fields === undefined) return null;
  if (!Array.isArray(options.fields) || options.fields.some(field => typeof field !== 'string')) throw new ProviderError('INVALID_FIELDS', 'fields must be an array of tag field names.');
  const aliases = { artwork: 'cover', coverUrl: 'cover', albumartist: 'albumArtist', syncedLyrics: 'lyrics', plainLyrics: 'lyrics' };
  const fields = [...new Set(options.fields.map(field => aliases[field] || field))];
  if (fields.some(field => !TAG_FIELDS.includes(field))) throw new ProviderError('INVALID_FIELDS', `Unknown tag field: ${fields.find(field => !TAG_FIELDS.includes(field))}`);
  return fields;
}
function wants(options, field) {
  const fields = selectedFields(options);
  return (fields === null || fields.includes(field)) && !(field === 'cover' && options.artwork === false) && !(field === 'lyrics' && options.lyrics === false);
}

class ProviderError extends Error {
  constructor(code, message, status) { super(message); this.name = 'ProviderError'; this.code = code; this.status = status; }
}
function aborted(signal) {
  if (signal?.aborted) throw new DOMException('The request was cancelled.', 'AbortError');
}
function wait(ms, signal) {
  aborted(signal);
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = () => { signal?.removeEventListener('abort', cancel); resolve(); };
    const timer = setTimeout(done, ms);
    const cancel = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); reject(new DOMException('The request was cancelled.', 'AbortError')); };
    signal?.addEventListener('abort', cancel, { once: true });
  });
}
async function schedule(url, options) {
  const { hostQueues, nextAllowed } = scopeFor(options);
  const host = new URL(url).hostname;
  const previous = hostQueues.get(host) || Promise.resolve();
  // Cancellation must not wait for an earlier caller's queued request.
  const turn = previous.catch(() => {}).then(async () => {
    aborted(options.signal);
    await wait(Math.max(0, (nextAllowed.get(host) || 0) - Date.now()), options.signal);
    nextAllowed.set(host, Date.now() + bounded(options.throttleMs, MIN_INTERVAL[host] ?? 250, 0, 10000));
  });
  hostQueues.set(host, turn);
  let onAbort;
  const cancellation = options.signal && new Promise((_, reject) => {
    onAbort = () => reject(new DOMException('The request was cancelled.', 'AbortError'));
    options.signal.addEventListener('abort', onAbort, { once: true });
  });
  try { await (cancellation ? Promise.race([turn, cancellation]) : turn); }
  finally {
    options.signal?.removeEventListener('abort', onAbort);
    if (hostQueues.get(host) === turn) turn.finally(() => { if (hostQueues.get(host) === turn) hostQueues.delete(host); }).catch(() => {});
  }
}
function errorRecord(source, error) {
  return { source, code: error.code || 'NETWORK', message: error.message || String(error), ...(error.status ? { status: error.status } : {}) };
}
function bounded(value, fallback, min, max) {
  const n = Number(value ?? fallback);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}
// Each caller owns a subscription; cancel the shared transport only when no callers remain.
async function json(url, options = {}) {
  aborted(options.signal);
  const scope = scopeFor(options);
  const ttl = bounded(options.cacheTtlMs, 60000, 0, 300000);
  const key = JSON.stringify([url, options.responseFormat || 'json', selectedFields(options)?.slice().sort() ?? '*', options.sources || DEFAULT_SOURCES, options.countries || options.country || 'CN', options.timeoutMs ?? 10000, options.retries ?? 1]);
  for (const [entryKey, entry] of scope.cache) if (entry.expires <= Date.now()) scope.cache.delete(entryKey);
  if (ttl > 0 && scope.cache.has(key)) {
    const entry = scope.cache.get(key);
    // A caller can shorten, but never silently extend, a cached response's TTL.
    if (Date.now() - entry.created < ttl) return structuredClone(entry.value);
    scope.cache.delete(key);
  }
  let entry = ttl > 0 ? scope.inflight.get(key) : null;
  if (!entry) {
    entry = { controller: new AbortController(), clients: 0, settled: false };
    entry.promise = requestJson(url, { ...options, signal: entry.controller.signal }).then(value => {
      if (ttl > 0 && !entry.controller.signal.aborted) {
        while (scope.cache.size >= 128) scope.cache.delete(scope.cache.keys().next().value);
        scope.cache.set(key, { value: structuredClone(value), created: Date.now(), expires: Date.now() + ttl });
      }
      return value;
    }).finally(() => {
      entry.settled = true;
      if (scope.inflight.get(key) === entry) scope.inflight.delete(key);
    });
    // At capacity callers still work, but do not add unbounded shared entries.
    if (ttl > 0 && scope.inflight.size < 64) scope.inflight.set(key, entry);
  }
  entry.clients++;
  return new Promise((resolve, reject) => {
    let finished = false;
    const detach = () => {
      if (finished) return false;
      finished = true;
      options.signal?.removeEventListener('abort', cancel);
      entry.clients--;
      if (!entry.clients && !entry.settled) {
        if (scope.inflight.get(key) === entry) scope.inflight.delete(key);
        entry.controller.abort();
      }
      return true;
    };
    const cancel = () => { if (detach()) reject(new DOMException('The request was cancelled.', 'AbortError')); };
    options.signal?.addEventListener('abort', cancel, { once: true });
    if (options.signal?.aborted) cancel();
    entry.promise.then(value => { if (detach()) resolve(structuredClone(value)); }, error => { if (detach()) reject(error); });
  });
}
// Kuwo's legacy endpoint returns a data literal. Convert only quoted string tokens;
// JSON.parse still validates the complete grammar. Never evaluate remote JavaScript.
function parseKuwo(input) {
  let output = '';
  for (let i = 0; i < input.length;) {
    if (input[i] !== "'" && input[i] !== '"') { output += input[i++]; continue; }
    const quote = input[i++]; let value = '', closed = false;
    while (i < input.length) {
      const char = input[i++];
      if (char === quote) { closed = true; break; }
      if (char !== '\\') { value += char; continue; }
      if (i >= input.length) throw new Error('Unterminated escape');
      const escape = input[i++];
      const simple = { n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', '/': '/', '\\': '\\', "'": "'", '"': '"' };
      if (Object.hasOwn(simple, escape)) value += simple[escape];
      else if (escape === 'u' && /^[\da-f]{4}$/i.test(input.slice(i, i + 4))) { value += String.fromCharCode(parseInt(input.slice(i, i + 4), 16)); i += 4; }
      else throw new Error('Unsupported escape');
    }
    if (!closed) throw new Error('Unterminated string');
    output += JSON.stringify(value);
  }
  return JSON.parse(output);
}
async function requestJson(url, options = {}) {
  const retries = Math.floor(bounded(options.retries, 1, 0, 2));
  const timeout = bounded(options.timeoutMs, 10000, 100, 30000);
  for (let attempt = 0; ; attempt++) {
    aborted(options.signal);
    await schedule(url, options);
    const controller = new AbortController();
    const forwardAbort = () => controller.abort();
    options.signal?.addEventListener('abort', forwardAbort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('timeout')), timeout);
    let retryDelay = 500 * (attempt + 1);
    try {
      aborted(options.signal);
      const response = await (options.fetch || globalThis.fetch)(url, {
        signal: controller.signal,
        headers: { Accept: options.responseFormat === 'text' ? 'text/plain' : 'application/json', 'User-Agent': USER_AGENT,
          ...(/(^|\.)qq\.com$/.test(new URL(url).hostname) ? { Referer: 'https://y.qq.com/' } : {}),
          ...(/(^|\.)kuwo\.cn$/.test(new URL(url).hostname) ? { Referer: 'https://www.kuwo.cn/' } : {}),
          ...(new URL(url).hostname === 'music.163.com' ? { Referer: 'https://music.163.com/' } : {}) }
      });
      if (!response.ok) {
        const status = response.status;
        const retryAfter = response.headers?.get('retry-after');
        if (retryAfter) {
          const seconds = Number(retryAfter);
          retryDelay = Math.min(5000, Math.max(0, Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - Date.now()) || 500);
        }
        const code = status === 429 ? 'RATE_LIMITED' : status === 403 || status === 451 ? 'BLOCKED' : status === 404 ? 'NOT_FOUND' : 'HTTP_ERROR';
        throw new ProviderError(code, `HTTP ${status} from ${new URL(url).hostname}${code === 'BLOCKED' ? ': provider access is blocked in this region or network.' : ''}`, status);
      }
      // Bodies are bounded even when an endpoint returns an unexpected proxy page.
      const declaredLength = Number(response.headers?.get('content-length'));
      if (declaredLength > 4 * 1024 * 1024) throw new ProviderError('RESPONSE_TOO_LARGE', 'Provider response exceeded 4 MiB.');
      let text = '';
      if (response.body?.getReader) {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let size = 0;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 4 * 1024 * 1024) { await reader.cancel(); throw new ProviderError('RESPONSE_TOO_LARGE', 'Provider response exceeded 4 MiB.'); }
            text += decoder.decode(value, { stream: true });
          }
          text += decoder.decode();
        } finally { reader.releaseLock(); }
      } else text = await response.text();
      if (text.length > 4 * 1024 * 1024) throw new ProviderError('RESPONSE_TOO_LARGE', 'Provider response exceeded 4 MiB.');
      if (options.responseFormat === 'text') return text;
      try { return options.responseFormat === 'kuwo' ? parseKuwo(text) : JSON.parse(text); }
      catch { throw new ProviderError('INVALID_RESPONSE', `Invalid JSON from ${new URL(url).hostname}; the service may be blocked.`); }
    } catch (error) {
      aborted(options.signal);
      if (controller.signal.aborted) error = new ProviderError('TIMEOUT', `Request to ${new URL(url).hostname} timed out after ${timeout} ms.`);
      const retryable = !error.code || error.code === 'TIMEOUT' || error.status === 429 || error.status >= 500;
      if (!retryable || attempt >= retries) throw error;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', forwardAbort);
    }
    await wait(retryDelay, options.signal);
  }
}
function text(value) { return value == null ? '' : String(value).trim(); }
function number(value) { const n = Number(value); return Number.isFinite(n) && n > 0 ? n : null; }
function year(value) { const match = text(value).match(/(?:19|20)\d{2}/); return match ? Number(match[0]) : null; }
function normalize(source, id, data) {
  return {
    id: `${source}:${id}`, source, title: text(data.title), artist: text(data.artist), album: text(data.album),
    albumArtist: text(data.albumArtist), year: year(data.year), track: number(data.track), disc: number(data.disc),
    genre: text(data.genre), duration: number(data.duration), coverUrl: text(data.coverUrl), url: text(data.url), score: 0,
    ...(data.releaseId ? { releaseId: data.releaseId } : {}), ...(data.releaseGroupId ? { releaseGroupId: data.releaseGroupId } : {})
  };
}
function norm(value) {
  return text(value).normalize('NFKC').toLowerCase().replace(/\.(mp3|flac|m4a|aac|ogg|opus|wav|aiff|aif)$/i, '')
    .replace(/[\p{P}\p{S}\s_]+/gu, '');
}
function similarity(a, b) {
  a = norm(a); b = norm(b);
  if (!a || !b) return 0;
  if (a === b) return 1;
  // Character bigrams cover Latin, Japanese and Chinese without word tokenization.
  const grams = s => {
    const chars = Array.from(s); const map = new Map();
    for (let i = 0; i < Math.max(1, chars.length - 1); i++) { const key = chars.slice(i, i + 2).join(''); map.set(key, (map.get(key) || 0) + 1); }
    return map;
  };
  const aa = grams(a); const bb = grams(b);
  let overlap = 0; let sizeA = 0; let sizeB = 0;
  for (const [key, n] of aa) { sizeA += n; overlap += Math.min(n, bb.get(key) || 0); }
  for (const n of bb.values()) sizeB += n;
  return 2 * overlap / (sizeA + sizeB);
}
// A filename separator is useful only outside a subtitle/version's brackets.
function filenameSeparators(stem, spacedOnly = false) {
  const positions = []; let depth = 0;
  for (let i = 0; i < stem.length; i++) {
    if (/[([{（【]/u.test(stem[i])) depth++;
    else if (/[)\]}）】]/u.test(stem[i])) depth = Math.max(0, depth - 1);
    else if (!depth && /[-–—]/u.test(stem[i]) && (!spacedOnly || /\s/u.test(stem[i - 1] || '') && /\s/u.test(stem[i + 1] || ''))) positions.push(i);
  }
  return positions;
}
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const TITLE_WORDS = /\b(?:titles?|themes?|fanfare|suite|overture|prelude|finale|opening|closing|soundtrack|score|song|version)\b/i;
const TITLE_SYNTAX = /\b(?:of|the|a|an|and|for|from|to|with|in|on|at|my|your|our|i|am|is|it|its|main|new|young|old|first|last|second|third)\b/i;
function filenameHints(local = {}) {
  let stem = text(local.filename || local.fileName || local.path).split(/[\\/]/).pop() || '';
  stem = stem.replace(/\.(mp3|flac|m4a|aac|ogg|opus|wav|aiff|aif)$/i, '').replace(/\s*[（(]\d{1,3}[）)]\s*$/, '').trim();
  const plain = { title: stem, artist: '', artistRobust: false };
  if (text(local.title) && norm(local.title) === norm(stem)) return plain;
  const parsed = (title, artist) => ({ title: text(title), artist: text(artist).replace(/\s*_\s*/g, ' / '), artistRobust: true });
  // Consume the explicit title-artist-film grammar from the right before trying
  // artist - title. This preserves hyphens and spaced subtitles within the title.
  // The film suffix is a search hint only; it never becomes local album evidence.
  const separators = filenameSeparators(stem);
  if (separators.length >= 2) {
    const [beforeArtist, beforeFilm] = separators.slice(-2);
    const artist = text(stem.slice(beforeArtist + 1, beforeFilm));
    const film = text(stem.slice(beforeFilm + 1));
    const filmHint = CJK.test(film) || /\b(?:ost|soundtrack|original (?:motion picture )?score)\b/i.test(film);
    if (beforeArtist > 0 && filmHint && /^[\p{L}\p{M}\s.’'&/_]+$/u.test(artist)
      && artist.length >= 2) return parsed(stem.slice(0, beforeArtist), artist);
  }
  const spaced = filenameSeparators(stem, true);
  const boundaries = spaced.length === 1 ? spaced : separators;
  if (boundaries.length !== 1) return plain;
  const left = text(stem.slice(0, boundaries[0])); const right = text(stem.slice(boundaries[0] + 1));
  if (!left || !right) return plain;
  if (!spaced.length && !CJK.test(left + right) && (left.split(/\s+/).length < 2 || right.split(/\s+/).length < 2)) return plain;
  // Actual tags can resolve direction. Without them require a plausible artist
  // and a title cue; ambiguous A - B subtitles remain whole title strings.
  if ((text(local.artist) && norm(local.artist) === norm(left)) || (text(local.title) && norm(local.title) === norm(right))) return parsed(right, left);
  if ((text(local.artist) && norm(local.artist) === norm(right)) || (text(local.title) && norm(local.title) === norm(left))) return parsed(left, right);
  const artistShape = value => /^[\p{L}\p{M} .’'&/_-]+$/u.test(value) && !TITLE_WORDS.test(value) && !TITLE_SYNTAX.test(value);
  const titleCue = value => TITLE_WORDS.test(value) || TITLE_SYNTAX.test(value);
  // Capitalization alone cannot tell Sweet Dreams from Eurythmics. Resolve
  // clear title cues in either direction; otherwise retain both hypotheses.
  if (artistShape(left) && titleCue(right) && !titleCue(left)) return parsed(right, left);
  if (artistShape(right) && titleCue(left) && !titleCue(right)) return parsed(left, right);
  return plain;
}
function localHints(local = {}) {
  const hints = filenameHints(local);
  return { title: text(local.title) || hints.title, artist: text(local.artist) || hints.artist, album: text(local.album), artistRobust: Boolean(text(local.artist)) || hints.artistRobust };
}
function lookupQuery(local = {}) {
  const hints = localHints(local);
  return [hints.title, hints.artist].filter(Boolean).join(' ');
}
function candidateFilenameHints(local, candidate) {
  const hints = localHints(local);
  if (hints.artist || text(local.title) || text(local.artist)) return hints;
  const stem = hints.title;
  const spaced = filenameSeparators(stem, true);
  const boundaries = spaced.length === 1 ? spaced : filenameSeparators(stem).slice(0, 12);
  // An ambiguous filename is never sufficient artist evidence on its own.
  // Both provider fields must corroborate a split; keep the whole-title
  // candidate competitive by giving inferred splits a ranking penalty.
  for (const boundary of boundaries) {
    const left = text(stem.slice(0, boundary)), right = text(stem.slice(boundary + 1));
    for (const [title, rawArtist, reversed] of [[left, right, false], [right, left, true]]) {
      const artist = rawArtist.replace(/\s*_\s*/g, ' / ');
      if (title && meaningfulArtist(artist) && norm(artist) === norm(candidate.artist)
        && similarity(title, candidate.title) >= 0.92) {
        return { ...hints, title, artist, artistRobust: false, candidateResolved: true, reversed };
      }
    }
  }
  return hints;
}
const VERSION_PATTERNS = [/(?:\blive(?:\s*version)?\b|\btour\b|unplugged|现场|現場|演唱会|演唱會)/i, /(?:instrumental|karaoke|music box|オルゴール|伴奏|纯音乐|純音樂)/i, /(?:\bremix\b)/i, /(?:\bdemo\b)/i];
function evidence(local = {}, candidate = {}) {
  const hints = candidateFilenameHints(local, candidate);
  const fields = [[hints.title, candidate.title, 55], [hints.artist, candidate.artist, 30], [hints.album, candidate.album, 10]];
  let total = 0; let weight = 0;
  for (const [a, b, w] of fields) { if (text(a)) { total += similarity(a, b) * w; weight += w; } }
  const duration = number(local.duration); const candidateDuration = number(candidate.duration);
  const delta = duration && candidateDuration ? Math.abs(duration - candidateDuration) : Infinity;
  const durationWindow = Math.max(10, (duration || 0) * 0.08);
  if (duration && candidateDuration) {
    total += Math.max(0, 1 - delta / durationWindow) * 5;
    weight += 5;
  }
  const raw = weight ? total / weight * 100 : 0;
  let cap = 99;
  if ((!text(local.title) && hints.title) || !meaningfulArtist(local.artist) || !meaningfulArtist(candidate.artist)) cap = 70;
  else if (!text(local.album) && !duration) cap = 94;
  const localVersion = `${hints.title} ${hints.album}`;
  const candidateVersion = `${candidate.title || ''} ${candidate.album || ''}`;
  const versionPenalty = VERSION_PATTERNS.reduce((sum, pattern) => sum + (pattern.test(candidateVersion) !== pattern.test(localVersion) ? 12 : 0), 0);
  // Apply contradictory evidence after the confidence ceiling, otherwise a
  // filename's 70-point ceiling erases both duration and version differences.
  const durationPenalty = !duration ? 0 : candidateDuration ? Math.round(Math.min(1, delta / durationWindow) * 20) : 5;
  const penalty = versionPenalty + durationPenalty;
  return { score: Math.max(0, Math.min(cap, Math.round(raw)) - penalty), rank: raw - penalty - (hints.candidateResolved ? (hints.reversed ? 11 : 8) : 0), delta, versionPenalty, hints };
}
function scoreCandidate(local = {}, candidate = {}) { return evidence(local, candidate).score; }
function rankCandidates(local = {}, candidates = []) {
  return candidates.map(candidate => ({ candidate, evidence: evidence(local, candidate) }))
    .sort((a, b) => b.evidence.rank - a.evidence.rank || a.evidence.delta - b.evidence.delta
      || sourcePriority(a.candidate.source) - sourcePriority(b.candidate.source)
      || text(a.candidate.source).localeCompare(text(b.candidate.source)) || text(a.candidate.id).localeCompare(text(b.candidate.id)))
    .map(({ candidate, evidence: result }) => ({ ...candidate, score: result.score }));
}
function sourcePriority(source) { const index = SOURCE_NAMES.indexOf(source); return index < 0 ? SOURCE_NAMES.length : index; }
function meaningfulArtist(value) {
  return Boolean(norm(value) && !/^(?:unknown(?:artist)?|various(?:artists)?|na|未知(?:艺术家|歌手)?|不明|群星)$/u.test(norm(value)));
}
function isRecommendedCandidate(local = {}, candidate = {}) {
  const result = evidence(local, candidate);
  const artistMatch = meaningfulArtist(result.hints.artist) && meaningfulArtist(candidate.artist)
    && result.hints.artistRobust && (meaningfulArtist(local.artist)
      ? similarity(local.artist, candidate.artist) >= 0.9
      : norm(result.hints.artist) === norm(candidate.artist));
  // This is a review recommendation, never permission to bypass a write threshold.
  // A bare title and duration cannot distinguish recordings of an ambiguous title.
  return Boolean(artistMatch && number(local.duration) && number(candidate.duration) && !result.versionPenalty
    && result.delta <= Math.max(3, Number(local.duration) * 0.015)
    && similarity(result.hints.title, candidate.title) >= 0.92);
}
function artists(items) { return (items || []).map(x => x.name || x.artist?.name || '').filter(Boolean).join(' / '); }
async function itunes(query, options) {
  const countries = options.countries || [options.country || 'CN', 'JP', 'US'];
  const unique = [...new Set(countries.map(c => text(c).toUpperCase()))];
  for (const country of unique) {
    if (!/^[A-Z]{2}$/.test(country)) throw new ProviderError('INVALID_COUNTRY', 'iTunes country must be a two-letter country code.');
    const params = new URLSearchParams({ term: query, country, media: 'music', entity: 'song', limit: String(options.limit) });
    const data = await json(`https://itunes.apple.com/search?${params}`, options);
    if (!Array.isArray(data.results)) throw new ProviderError('INVALID_RESPONSE', 'iTunes returned no results array.');
    const results = data.results.filter(x => x.trackId && x.trackName).map(x => normalize('itunes', x.trackId, {
      title: x.trackName, artist: x.artistName, album: x.collectionName, albumArtist: x.collectionArtistName || x.artistName,
      year: x.releaseDate, track: x.trackNumber, disc: x.discNumber, genre: x.primaryGenreName, duration: x.trackTimeMillis / 1000,
      coverUrl: text(x.artworkUrl100 || x.artworkUrl60).replace(/\/\d+x\d+bb(?:-\d+)?\./, '/1200x1200bb.'), url: x.trackViewUrl || x.collectionViewUrl
    }));
    if (results.length) return results;
  }
  return [];
}
async function netease(query, options) {
  const params = new URLSearchParams({ s: query, type: '1', offset: '0', limit: String(options.limit) });
  const data = await json(`https://music.163.com/api/search/get?${params}`, options);
  if (data.code !== 200) throw new ProviderError('PROVIDER_ERROR', `NetEase search returned code ${data.code ?? 'unknown'}: ${data.message || data.msg || 'service unavailable or blocked'}`);
  if (!data.result || (!Array.isArray(data.result.songs) && data.result.songCount !== 0)) throw new ProviderError('INVALID_RESPONSE', 'NetEase returned an unexpected search response.');
  return (data.result.songs || []).map(x => normalize('netease', x.id, {
    title: x.name, artist: artists(x.artists || x.ar), album: (x.album || x.al)?.name,
    albumArtist: artists((x.album || x.al)?.artists), year: (x.album || x.al)?.publishTime ? new Date((x.album || x.al).publishTime).getUTCFullYear() : null,
    track: x.no, disc: x.disc, duration: (x.duration ?? x.dt) / 1000, coverUrl: (x.album || x.al)?.picUrl,
    url: `https://music.163.com/#/song?id=${x.id}`
  }));
}
async function musicbrainz(query, options) {
  // Qualify known artist/title only when both are in the actual manual query.
  // Otherwise the manual query remains authoritative (including Lucene fields).
  const local = options.local;
  const quote = value => text(value).replace(/[\\"]/g, '\\$&');
  if (local?.title && local?.artist && norm(query).includes(norm(local.title)) && norm(query).includes(norm(local.artist)) && !/\w+:/.test(query)) {
    query = `recording:"${quote(local.title)}" AND artist:"${quote(local.artist)}"`;
  }
  const params = new URLSearchParams({ query, fmt: 'json', limit: String(options.limit) });
  const data = await json(`https://musicbrainz.org/ws/2/recording/?${params}`, options);
  if (!Array.isArray(data.recordings)) throw new ProviderError('INVALID_RESPONSE', 'MusicBrainz returned no recordings array.');
  return data.recordings.map(x => {
    const releases = [...(x.releases || [])];
    const releaseRank = r => (r.status === 'Official' ? 100 : 0) + (r['release-group']?.['primary-type'] === 'Album' ? 30 : 0)
      + similarity(local?.album, r.title) * 60 + similarity(artists(x['artist-credit']), artists(r['artist-credit'])) * 20
      + (norm(r.title) === norm(x.title) ? 10 : 0);
    releases.sort((a, b) => releaseRank(b) - releaseRank(a) || text(a.date || '9999').localeCompare(text(b.date || '9999')) || text(a.id).localeCompare(text(b.id)));
    const release = releases[0] || {};
    const medium = release.media?.[0];
    const track = (medium?.track || medium?.tracks || [])[0];
    return normalize('musicbrainz', x.id, {
      title: x.title, artist: artists(x['artist-credit']), album: release.title, albumArtist: artists(release['artist-credit'] || x['artist-credit']),
      year: x['first-release-date'] || release.date, track: track?.number || track?.position, disc: medium?.position,
      duration: x.length / 1000, releaseId: release.id, releaseGroupId: release['release-group']?.id,
      coverUrl: release.id ? `https://coverartarchive.org/release/${release.id}/front-500` : '', url: `https://musicbrainz.org/recording/${x.id}`
    });
  });
}
const extraAdapters = require('./provider-adapters.cjs')({ request: json, normalize, text, number, year, artists, ProviderError, wants, aborted });
async function search(query, options = {}) {
  aborted(options.signal);
  const fields = selectedFields(options);
  if (fields?.length === 0) return { candidates: [], errors: [] };
  query = text(query);
  if (!query) throw new ProviderError('INVALID_QUERY', 'Enter an artist, title, or album to search.');
  if (query.length > 500) throw new ProviderError('INVALID_QUERY', 'Search query is limited to 500 characters.');
  const sources = options.sources ?? DEFAULT_SOURCES;
  if (!Array.isArray(sources)) throw new ProviderError('INVALID_SOURCES', 'sources must be an array of provider names.');
  const errors = [];
  const local = options.local || (options.autoFilename ? { filename: query } : { title: query });
  const opts = { ...options, local, limit: Math.max(1, Math.min(50, Math.floor(Number(options.limit) || 20))) };
  const hints = localHints(local);
  // The flag enables at most two fallback queries for an automatic filename
  // lookup. A changed manual query remains authoritative even with a stale flag.
  const automatic = options.autoFilename === true && [local.filename, local.fileName, local.path, lookupQuery(local)].some(value => text(value) === query);
  const fallback = hints.artist ? hints.title : hints.title.replace(/\s*[-–—]\s*/g, ' ');
  const queries = [...new Set((automatic ? [query, lookupQuery(local), fallback] : [query]).map(text).filter(value => value && value.length <= 500))];
  const useful = candidate => {
    const resolved = candidateFilenameHints(local, candidate);
    return similarity(resolved.title, candidate.title) >= 0.8
      && (!resolved.artist || similarity(resolved.artist, candidate.artist) >= 0.65)
      && (!number(local.duration) || (number(candidate.duration) && Math.abs(local.duration - candidate.duration) <= Math.max(10, local.duration * 0.08)))
      && !evidence(local, candidate).versionPenalty;
  };
  const handlers = { itunes, netease, musicbrainz, qq: extraAdapters.qq, kuwo: extraAdapters.kuwo, vgmdb: extraAdapters.vgmdb };
  const groups = await Promise.all([...new Set(sources)].map(async source => {
    if (!Object.hasOwn(handlers, source)) { errors.push({ source: String(source), code: 'UNKNOWN_SOURCE', message: `Unknown metadata provider: ${String(source)}` }); return []; }
    const found = [];
    try {
      for (const attempt of queries) {
        const results = await handlers[source](attempt, opts);
        found.push(...results);
        if (results.some(useful)) break;
      }
    } catch (error) { aborted(options.signal); errors.push(errorRecord(source, error)); }
    return found;
  }));
  aborted(options.signal);
  const seen = new Set();
  const candidates = rankCandidates(local, groups.flat().filter(c => { if (seen.has(c.id)) return false; seen.add(c.id); return true; })
    .map(c => wants(options, 'cover') ? c : { ...c, coverUrl: '' }));
  errors.sort((a, b) => String(a.source).localeCompare(String(b.source)));
  return { candidates, errors };
}
async function lrclib(candidate, options) {
  const params = new URLSearchParams({ track_name: candidate.title, artist_name: candidate.artist });
  if (candidate.album) params.set('album_name', candidate.album);
  if (number(candidate.duration)) params.set('duration', String(Math.round(candidate.duration)));
  let exact;
  try { exact = await json(`https://lrclib.net/api/get?${params}`, options); }
  catch (error) { if (error.status !== 404) throw error; }
  if (exact && (exact.syncedLyrics || exact.plainLyrics || exact.instrumental)) return exact;
  const searchParams = new URLSearchParams({ track_name: candidate.title, artist_name: candidate.artist });
  const found = await json(`https://lrclib.net/api/search?${searchParams}`, options);
  if (!Array.isArray(found)) throw new ProviderError('INVALID_RESPONSE', 'LRCLIB returned no lyrics array.');
  const ranked = found.map(x => ({ x, score: scoreCandidate(candidate, { title: x.trackName, artist: x.artistName, album: x.albumName, duration: x.duration }) }))
    .filter(({ x }) => similarity(candidate.title, x.trackName) >= 0.8 && similarity(candidate.artist, x.artistName) >= 0.65 && (!number(candidate.duration) || !number(x.duration) || Math.abs(candidate.duration - x.duration) <= 15))
    .sort((a, b) => b.score - a.score);
  if (!ranked.length || !(ranked[0].x.syncedLyrics || ranked[0].x.plainLyrics || ranked[0].x.instrumental)) throw new ProviderError('NOT_FOUND', 'No sufficiently matching lyrics found in LRCLIB.');
  return ranked[0].x;
}
async function enrich(candidate, options = {}) {
  aborted(options.signal);
  const fields = selectedFields(options);
  if (!candidate || !text(candidate.title)) throw new ProviderError('INVALID_CANDIDATE', 'A candidate with a title is required.');
  if (fields?.length === 0) return { id: candidate.id, source: candidate.source, errors: [] };
  const tags = {};
  for (const key of ['id', 'source', 'title', 'artist', 'album', 'albumArtist', 'year', 'track', 'disc', 'genre', 'duration', 'url']) tags[key] = candidate[key] ?? (['year', 'track', 'disc', 'duration'].includes(key) ? null : '');
  for (const key of ['composer', 'lyricist', 'comment']) if (Object.hasOwn(candidate, key)) tags[key] = text(candidate[key]);
  tags.coverUrl = wants(options, 'cover') ? text(candidate.coverUrl) : '';
  tags.artwork = tags.coverUrl;
  tags.lyrics = ''; tags.syncedLyrics = ''; tags.plainLyrics = ''; tags.errors = [];
  const id = text(candidate.id).replace(/^netease:/, '');
  const tasks = [];
  const needNeteaseDetails = candidate.source === 'netease' && /^\d+$/.test(id) && (
    fields === null && wants(options, 'cover') || wants(options, 'cover') && !tags.coverUrl
    || ['album', 'albumArtist', 'year', 'track', 'disc'].some(field => wants(options, field) && !tags[field]));
  if (wants(options, 'cover') || needNeteaseDetails) tasks.push((async () => {
    try {
      if (needNeteaseDetails) {
        const data = await json(`https://music.163.com/api/song/detail/?${new URLSearchParams({ ids: JSON.stringify([Number(id)]) })}`, options);
        if (data.code !== 200) throw new ProviderError('PROVIDER_ERROR', `NetEase detail returned code ${data.code ?? 'unknown'}.`);
        const song = data.songs?.[0];
        if (!song) throw new ProviderError('NOT_FOUND', 'NetEase song details were not found.');
        const album = song.album || song.al;
        if (wants(options, 'cover') && album?.picUrl) tags.coverUrl = album.picUrl.replace(/^http:/, 'https:');
        if (wants(options, 'album') && !tags.album) tags.album = text(album?.name);
        if (wants(options, 'year') && !tags.year && album?.publishTime) tags.year = new Date(album.publishTime).getUTCFullYear();
        if (wants(options, 'track') && !tags.track && song.no) tags.track = song.no;
        if (wants(options, 'disc') && !tags.disc && number(song.disc)) tags.disc = number(song.disc);
        if (wants(options, 'albumArtist') && !tags.albumArtist) tags.albumArtist = artists(album?.artists);
      } else if (wants(options, 'cover') && candidate.source === 'kuwo') {
        tags.coverUrl = await extraAdapters.kuwoCover(candidate, options);
      } else if (wants(options, 'cover') && candidate.source === 'musicbrainz' && (candidate.releaseId || candidate.releaseGroupId)) {
        const targets = [candidate.releaseId && ['release', candidate.releaseId], candidate.releaseGroupId && ['release-group', candidate.releaseGroupId]].filter(Boolean);
        tags.coverUrl = '';
        let lastError;
        for (const [kind, releaseId] of targets) {
          try {
            const data = await json(`https://coverartarchive.org/${kind}/${encodeURIComponent(releaseId)}`, options);
            const image = data.images?.find(x => x.front && x.approved !== false) || data.images?.find(x => x.front);
            if (!image) throw new ProviderError('NOT_FOUND', 'Cover Art Archive has no front cover for this release.');
            tags.coverUrl = text(image.thumbnails?.['1200'] || image.thumbnails?.large || image.image).replace(/^http:/, 'https:');
            if (tags.coverUrl) break;
          } catch (error) { aborted(options.signal); lastError = error; }
        }
        if (!tags.coverUrl && lastError) throw lastError;
      }
      if (wants(options, 'cover') && !tags.coverUrl) throw new ProviderError('NOT_FOUND', 'No cover artwork is available for this candidate.');
    } catch (error) { aborted(options.signal); tags.errors.push(errorRecord(candidate.source === 'musicbrainz' ? 'coverartarchive' : candidate.source, error)); }
    tags.artwork = tags.coverUrl;
  })());
  if (wants(options, 'lyrics')) tasks.push((async () => {
    let lyricData;
    if (candidate.source === 'qq' || candidate.source === 'kuwo') {
      try { lyricData = await extraAdapters[candidate.source === 'qq' ? 'qqLyrics' : 'kuwoLyrics'](candidate, options); }
      catch (error) { aborted(options.signal); tags.errors.push(errorRecord(candidate.source, error)); }
    }
    if (candidate.source === 'netease' && /^\d+$/.test(id)) {
      try {
        const data = await json(`https://music.163.com/api/song/lyric?${new URLSearchParams({ id, lv: '-1', kv: '-1', tv: '-1' })}`, options);
        if (data.code !== 200) throw new ProviderError('PROVIDER_ERROR', `NetEase lyric returned code ${data.code ?? 'unknown'}.`);
        if (data.lrc?.lyric) lyricData = { syncedLyrics: data.lrc.lyric, plainLyrics: '', translatedLyrics: data.tlyric?.lyric || '' };
        else if (data.nolyric) lyricData = { instrumental: true };
        else tags.errors.push({ source: 'netease', code: 'NOT_FOUND', message: 'NetEase has no lyrics for this song; trying LRCLIB.' });
      } catch (error) { aborted(options.signal); tags.errors.push(errorRecord('netease', error)); }
    }
    if (!lyricData && options.lyricsFallback !== false) {
      if (!text(candidate.artist)) tags.errors.push({ source: 'lrclib', code: 'MISSING_METADATA', message: 'An artist name is required to match lyrics safely.' });
      else try { lyricData = await lrclib(candidate, options); }
      catch (error) { aborted(options.signal); tags.errors.push(errorRecord('lrclib', error)); }
    }
    if (lyricData) {
      tags.syncedLyrics = text(lyricData.syncedLyrics); tags.plainLyrics = text(lyricData.plainLyrics);
      tags.lyrics = tags.syncedLyrics || tags.plainLyrics;
      if (lyricData.translatedLyrics) tags.translatedLyrics = lyricData.translatedLyrics;
      if (lyricData.instrumental) tags.instrumental = true;
    }
  })());
  await Promise.all(tasks);
  aborted(options.signal);
  tags.errors.sort((a, b) => String(a.source).localeCompare(String(b.source)));
  if (fields !== null) {
    const selected = { id: tags.id, source: tags.source, errors: tags.errors };
    for (const field of fields) {
      if (field === 'cover' && wants(options, 'cover')) { selected.coverUrl = tags.coverUrl; selected.artwork = tags.artwork; }
      else if (field === 'lyrics' && wants(options, 'lyrics')) {
        for (const key of ['lyrics', 'syncedLyrics', 'plainLyrics', 'translatedLyrics', 'instrumental']) if (Object.hasOwn(tags, key)) selected[key] = tags[key];
      } else if (Object.hasOwn(tags, field)) selected[field] = tags[field];
    }
    return selected;
  }
  return tags;
}

module.exports = { search, enrich, scoreCandidate, lookupQuery, rankCandidates, isRecommendedCandidate, SOURCE_NAMES, DEFAULT_SOURCES, SOURCE_CATALOG };
