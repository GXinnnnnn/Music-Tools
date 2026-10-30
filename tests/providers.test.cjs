'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { search, enrich, scoreCandidate, lookupQuery, rankCandidates, isRecommendedCandidate } = require('../source/core/providers.cjs');
const response = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', ...headers } });
const opts = fetch => ({ fetch, throttleMs: 0, retries: 0, timeoutMs: 500 });

test('iTunes normalizes Unicode metadata and preserves manual country/query', async () => {
  let requested;
  const result = await search('宇多田ヒカル First Love', { ...opts(async url => {
    requested = new URL(url);
    return response({ results: [{ trackId: 1, trackName: 'First Love', artistName: '宇多田ヒカル', collectionName: 'First Love', releaseDate: '1999-03-10T00:00:00Z', trackNumber: 7, discNumber: 1, primaryGenreName: 'J-Pop', trackTimeMillis: 257000, artworkUrl100: 'https://img.example/100x100bb.jpg', trackViewUrl: 'https://music.apple.com/1' }] });
  }), sources: ['itunes'], country: 'JP', local: { title: 'First Love', artist: '宇多田ヒカル', album: 'First Love', duration: 257 } });
  assert.equal(requested.searchParams.get('country'), 'JP');
  assert.equal(requested.searchParams.get('term'), '宇多田ヒカル First Love');
  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.candidates[0], { id: 'itunes:1', source: 'itunes', title: 'First Love', artist: '宇多田ヒカル', album: 'First Love', albumArtist: '宇多田ヒカル', year: 1999, track: 7, disc: 1, genre: 'J-Pop', duration: 257, coverUrl: 'https://img.example/1200x1200bb.jpg', url: 'https://music.apple.com/1', score: 99 });
});

test('empty iTunes country falls back to JP then US without duplicate requests', async () => {
  const countries = [];
  const result = await search('test', { ...opts(async url => { const c = new URL(url).searchParams.get('country'); countries.push(c); return response({ results: c === 'US' ? [{ trackId: 1, trackName: 'test' }] : [] }); }), sources: ['itunes'], country: 'CN' });
  assert.deepEqual(countries, ['CN', 'JP', 'US']);
  assert.equal(result.candidates.length, 1);
});

test('sources are independently selectable and failures preserve other results', async () => {
  const called = [];
  const result = await search('周杰伦 晴天', { ...opts(async url => {
    called.push(new URL(url).hostname);
    if (url.includes('music.163.com')) return response({}, 403);
    return response({ recordings: [{ id: 'r1', title: '晴天', length: 269000, 'artist-credit': [{ name: '周杰伦' }], releases: [{ id: 'a1', title: '葉惠美', status: 'Official', date: '2003-07-31', 'release-group': { id: 'g1', 'primary-type': 'Album' } }] }] });
  }), sources: ['netease', 'musicbrainz', 'bogus', 'netease'] });
  assert.deepEqual(called.sort(), ['music.163.com', 'musicbrainz.org']);
  assert.equal(result.candidates[0].title, '晴天');
  assert.equal(result.candidates[0].year, 2003);
  assert.equal(result.candidates[0].releaseId, 'a1');
  assert.deepEqual(result.errors.map(e => e.code).sort(), ['BLOCKED', 'UNKNOWN_SOURCE']);
});

test('MusicBrainz qualifies known artist/title and preserves a changed manual query', async () => {
  const queries = [];
  const options = { ...opts(async url => { queries.push(new URL(url).searchParams.get('query')); return response({ recordings: [] }); }), sources: ['musicbrainz'], local: { title: 'First Love', artist: '宇多田ヒカル' } };
  await search('宇多田ヒカル First Love', options);
  await search('Other Song Other Artist', options);
  await search('artist:Utada AND recording:Love', options);
  assert.deepEqual(queries, ['recording:"First Love" AND artist:"宇多田ヒカル"', 'Other Song Other Artist', 'artist:Utada AND recording:Love']);
});

test('MusicBrainz prefers original dated albums and maps available track positions', async () => {
  const result = await search('Song Artist', { ...opts(async () => response({ recordings: [{ id: 'r', title: 'Song', 'artist-credit': [{ name: 'Artist' }], releases: [
    { id: 'new', title: 'Album', status: 'Official', date: '2024', 'release-group': { 'primary-type': 'Album' } },
    { id: 'original', title: 'Album', status: 'Official', date: '1999', 'release-group': { 'primary-type': 'Album' }, media: [{ position: 2, track: [{ number: '3' }] }] }
  ] }] })), sources: ['musicbrainz'] });
  assert.equal(result.candidates[0].releaseId, 'original');
  assert.equal(result.candidates[0].year, 1999);
  assert.equal(result.candidates[0].track, 3);
  assert.equal(result.candidates[0].disc, 2);
});

test('NetEase normalization, details and native timed lyrics', async () => {
  const fetch = async url => {
    if (url.includes('/api/search/')) return response({ code: 200, result: { songs: [{ id: 42, name: '晴天', artists: [{ name: '周杰伦' }], album: { name: '葉惠美' }, duration: 269000 }] } });
    if (url.includes('/api/song/detail/')) return response({ code: 200, songs: [{ id: 42, no: 3, disc: '1', album: { publishTime: Date.UTC(2003, 6, 31), picUrl: 'http://p1.music.126.net/cover.jpg', artists: [{ name: '周杰伦' }] } }] });
    if (url.includes('/api/song/lyric')) return response({ code: 200, lrc: { lyric: '[00:01.00]故事的小黃花' }, tlyric: { lyric: '[00:01.00]Translation' } });
    throw new Error(`Unexpected URL ${url}`);
  };
  const result = await search('晴天', { ...opts(fetch), sources: ['netease'] });
  const tags = await enrich(result.candidates[0], opts(fetch));
  assert.equal(tags.lyrics, '[00:01.00]故事的小黃花');
  assert.equal(tags.translatedLyrics, '[00:01.00]Translation');
  assert.equal(tags.artwork, 'https://p1.music.126.net/cover.jpg');
  assert.equal(tags.albumArtist, '周杰伦');
  assert.equal(tags.track, 3);
  assert.equal(tags.disc, 1);
  assert.equal(tags.year, 2003);
  assert.deepEqual(tags.errors, []);
});

test('CAA release fallback and LRCLIB exact lyrics work independently', async () => {
  const candidate = { id: 'musicbrainz:r', source: 'musicbrainz', title: 'First Love', artist: '宇多田ヒカル', album: 'First Love', duration: 257, releaseId: 'release', releaseGroupId: 'group', coverUrl: 'https://coverartarchive.org/release/release/front-500' };
  const tags = await enrich(candidate, opts(async url => {
    if (url.includes('/release/release')) return response({}, 404);
    if (url.includes('/release-group/group')) return response({ images: [{ front: true, approved: true, image: 'https://archive.org/original.jpg', thumbnails: { '1200': 'https://archive.org/1200.jpg' } }] });
    if (url.includes('lrclib.net/api/get')) return response({ syncedLyrics: '[00:10.00]最後のキスは', plainLyrics: '最後のキスは' });
    throw new Error(url);
  }));
  assert.equal(tags.artwork, 'https://archive.org/1200.jpg');
  assert.equal(tags.syncedLyrics, '[00:10.00]最後のキスは');
  assert.equal(tags.plainLyrics, '最後のキスは');
  assert.deepEqual(tags.errors, []);
});

test('lyrics fallback rejects an unrelated song instead of attaching it', async () => {
  const tags = await enrich({ source: 'itunes', id: 'itunes:1', title: 'First Love', artist: '宇多田ヒカル', duration: 257, coverUrl: 'https://example.com/cover.jpg' }, opts(async url => {
    if (url.includes('/api/get?')) return response({}, 404);
    return response([{ trackName: 'First Love', artistName: 'Unrelated Person', duration: 257, plainLyrics: 'Wrong lyrics' }]);
  }));
  assert.equal(tags.lyrics, '');
  assert.equal(tags.errors[0].source, 'lrclib');
  assert.equal(tags.errors[0].code, 'NOT_FOUND');
});

test('lyrics search chooses matching title artist and duration', async () => {
  const tags = await enrich({ source: 'itunes', title: '晴天', artist: '周杰伦', album: '葉惠美', duration: 269 }, { ...opts(async url => {
    if (url.includes('/api/get?')) return response({}, 404);
    return response([{ trackName: '晴天', artistName: '周杰伦', albumName: '葉惠美', duration: 800, plainLyrics: 'Wrong live version' }, { trackName: '晴天', artistName: '周杰伦', albumName: '葉惠美', duration: 269, plainLyrics: '故事的小黃花' }]);
  }), artwork: false });
  assert.equal(tags.lyrics, '故事的小黃花');
  assert.deepEqual(tags.errors, []);
});

test('instrumental is a valid result without missing-lyrics error', async () => {
  const tags = await enrich({ source: 'itunes', title: 'Instrumental', artist: 'Artist' }, { ...opts(async () => response({ instrumental: true })), artwork: false });
  assert.equal(tags.instrumental, true);
  assert.equal(tags.lyrics, '');
  assert.deepEqual(tags.errors, []);
});

test('request timeout becomes a clear partial provider error', async () => {
  const result = await search('test', { ...opts(async (_, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true }))), timeoutMs: 100, sources: ['itunes'] });
  assert.equal(result.candidates.length, 0);
  assert.equal(result.errors[0].code, 'TIMEOUT');
  assert.match(result.errors[0].message, /100 ms/);
});

test('abort before search and during fetch reject AbortError', async () => {
  const early = new AbortController(); early.abort();
  await assert.rejects(search('test', { signal: early.signal }), { name: 'AbortError' });
  const controller = new AbortController();
  const pending = search('test', { ...opts(async (_, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    setTimeout(() => controller.abort(), 10);
  })), sources: ['itunes'], signal: controller.signal });
  await assert.rejects(pending, { name: 'AbortError' });
});

test('429 retries once and malformed JSON reports INVALID_RESPONSE', async () => {
  let count = 0;
  const result = await search('test', { ...opts(async () => ++count === 1 ? response({}, 429, { 'retry-after': '0' }) : response({ result: { songs: [], songCount: 0 }, code: 200 })), retries: 1, sources: ['netease'] });
  assert.equal(count, 2);
  assert.deepEqual(result.errors, []);
  const broken = await search('test', { ...opts(async () => new Response('<html>blocked</html>')), sources: ['netease'] });
  assert.equal(broken.errors[0].code, 'INVALID_RESPONSE');
});

test('response size is bounded and invalid queries reject before fetching', async () => {
  const result = await search('test', { ...opts(async () => response({}, 200, { 'content-length': String(5 * 1024 * 1024) })), sources: ['netease'] });
  assert.equal(result.errors[0].code, 'RESPONSE_TOO_LARGE');
  await assert.rejects(search(' '), { code: 'INVALID_QUERY' });
  await assert.rejects(search('x'.repeat(501)), { code: 'INVALID_QUERY' });
  await assert.rejects(search('x', { sources: 'itunes' }), { code: 'INVALID_SOURCES' });
  assert.deepEqual(await search('x', { sources: [] }), { candidates: [], errors: [] });
});

test('scoring is deterministic, multilingual, duration aware and never claims certainty', () => {
  const candidate = { title: '晴天', artist: '周杰伦', album: '葉惠美', duration: 269 };
  assert.equal(scoreCandidate(candidate, candidate), 99);
  assert.equal(scoreCandidate({ filename: '晴天.flac' }, candidate), 70);
  assert.equal(scoreCandidate({ path: 'C:\\music\\晴天.flac' }, candidate), 70);
  assert.equal(scoreCandidate({ title: '晴天' }, candidate), 70);
  assert.ok(scoreCandidate(candidate, candidate) > scoreCandidate(candidate, { ...candidate, artist: '別人' }));
  assert.ok(scoreCandidate(candidate, candidate) > scoreCandidate(candidate, { ...candidate, duration: 500 }));
  assert.equal(scoreCandidate({ title: 'Ｆｉｒｓｔ　Ｌｏｖｅ', artist: '宇多田ヒカル' }, { title: 'First Love', artist: '宇多田ヒカル' }), 94);
  assert.equal(scoreCandidate({}, candidate), 0);
  assert.ok(scoreCandidate(candidate, { ...candidate, album: 'Music Box Instrumental Collection' }) < 90);
  assert.ok(scoreCandidate(candidate, { ...candidate, album: 'World Tour 2024' }) < 90);
});

test('filename-only scoring retains duration and version contradictions below the confidence cap', () => {
  const local = { filename: 'First Class.mp3', duration: 240 };
  const correct = { id: 'z', source: 'itunes', title: 'First Class', artist: 'Composer', album: 'Soundtrack', duration: 240 };
  const wrongDuration = { ...correct, id: 'a', artist: 'Another Artist', duration: 180 };
  const live = { ...correct, id: 'b', album: 'Live' };
  const unknownDuration = { ...correct, id: 'c', duration: null };
  const input = [wrongDuration, live, unknownDuration, correct];
  const ranked = rankCandidates(local, input);
  assert.deepEqual(ranked.map(c => c.id), ['z', 'c', 'b', 'a']);
  assert.equal(ranked[0].score, 70);
  assert.equal(ranked.find(c => c.id === 'a').score, 50);
  assert.equal(ranked.find(c => c.id === 'b').score, 58);
  assert.equal(ranked.find(c => c.id === 'c').score, 65, 'missing duration cannot share the measured match confidence');
  assert.ok(ranked.every(c => c.score <= 70));
  assert.deepEqual(ranked[0], { ...correct, score: 70 });
  assert.equal(Object.hasOwn(correct, 'score'), false, 'ranking must not mutate input candidates');
  assert.deepEqual(input.map(c => c.id), ['a', 'b', 'c', 'z']);
});

test('uncapped evidence and small duration differences determine filename-only ordering', () => {
  const local = { filename: 'A New Beginning.ogg', duration: 240 };
  const exact = { id: 'z', title: 'A New Beginning', duration: 240 };
  const nearby = { id: 'a', title: 'A New Beginning', duration: 240.2 };
  const similarTitle = { id: 'b', title: 'A New Beginnings', duration: 240 };
  const ranked = rankCandidates(local, [similarTitle, nearby, exact]);
  assert.deepEqual(ranked.map(c => c.id), ['z', 'a', 'b']);
  assert.ok(ranked.every(c => c.score === 70), 'tied confidence scores retain evidence-based ranking');
});

test('filename hints remove duplicate suffixes and conservatively preserve hyphenated titles', () => {
  assert.equal(lookupQuery({ filename: 'First Class (1).mp3' }), 'First Class');
  assert.equal(lookupQuery({ fileName: '歌名（2）.ogg' }), '歌名');
  assert.equal(lookupQuery({ path: 'C:\\music\\Composer - Spider-Man Theme (1).flac' }), 'Spider-Man Theme Composer');
  assert.equal(lookupQuery({ filename: 'Spider-Man Theme.mp3' }), 'Spider-Man Theme');
  assert.equal(lookupQuery({ filename: 'First Class-Henry Jackman-X战警.mp3' }), 'First Class Henry Jackman');
  assert.equal(lookupQuery({ filename: 'Spider-Man Theme-Another Composer-电影配乐 (1).ogg' }), 'Spider-Man Theme Another Composer');
  assert.equal(lookupQuery({ filename: 'One-Two-Three.mp3' }), 'One-Two-Three');
  const local = { filename: 'First Class-Henry Jackman-X战警.mp3', duration: 240 };
  const correct = { title: 'First Class', artist: 'Henry Jackman', duration: 240 };
  assert.equal(scoreCandidate(local, correct), 70);
  assert.ok(scoreCandidate(local, { ...correct, artist: 'Unrelated Person' }) < 70);
  assert.equal(scoreCandidate({ filename: 'First Class (1).mp3' }, correct), 70);
});

test('real soundtrack filenames preserve subtitles and distinguish explicit artist fields', () => {
  const cases = [
    ['Captain America(1).mp3', 'Captain America'],
    ['Hooked On A Feeling(1).mp3', 'Hooked On A Feeling'],
    ['Becoming Spider-Man.mp3', 'Becoming Spider-Man'],
    ['Main Title - Young Peter.mp3', 'Main Title - Young Peter'],
    ['Main Title - Young Peter (1).mp3', 'Main Title - Young Peter'],
    ['Main Title (Album Version).mp3', 'Main Title (Album Version)'],
    ['Marvel Studios Fanfare (Digital Booklet - Thor_ The Dar).mp3', 'Marvel Studios Fanfare (Digital Booklet - Thor_ The Dar)'],
    ['New Avengers - Avengers_ Age of Ultron.mp3', 'New Avengers - Avengers_ Age of Ultron'],
    ['Ramin Djawadi - Merchant Of Death.mp3', 'Merchant Of Death Ramin Djawadi'],
    ['Ramin Djawadi - Mark I.mp3', 'Mark I Ramin Djawadi'],
    ['Main Title - Young Peter-Henry Jackman-电影配乐.mp3', 'Main Title - Young Peter Henry Jackman'],
    ["I'm Spider-Man - Hans Zimmer _ The Magnificent Six _ Pharrell Williams _ Johnny Marr-超凡蜘蛛侠2.mp3", "I'm Spider-Man Hans Zimmer / The Magnificent Six / Pharrell Williams / Johnny Marr"],
    ['My Enemy - Hans Zimmer _ The Magnificent Six _ Pharrell Williams _ Johnny Marr-超凡蜘蛛侠2.mp3', 'My Enemy Hans Zimmer / The Magnificent Six / Pharrell Williams / Johnny Marr']
  ];
  for (const [filename, query] of cases) assert.equal(lookupQuery({ filename }), query, filename);
  assert.equal(lookupQuery({ filename: 'Blue Moon - Silent Night.mp3' }), 'Blue Moon - Silent Night', 'uncertain artist/title grammar stays intact');
  assert.equal(lookupQuery({ filename: 'One-Two-Three.mp3' }), 'One-Two-Three');
  assert.equal(lookupQuery({ filename: 'Movement (1984).flac' }), 'Movement (1984)', 'a year is not a copy suffix');
  assert.equal(lookupQuery({ filename: 'Theme (1) Reprise.mp3' }), 'Theme (1) Reprise', 'only terminal copy suffixes are removed');
  const local = { filename: 'Opening Theme-Henry Jackman-电影配乐.mp3', title: 'Tagged Song', artist: 'Tagged Artist', album: 'Tagged Album' };
  assert.equal(lookupQuery(local), 'Tagged Song Tagged Artist', 'actual tags remain authoritative');
  assert.equal(lookupQuery({ filename: 'Blue Moon - Silent Night.mp3', artist: 'Silent Night' }), 'Blue Moon Silent Night', 'actual artist resolves title-artist direction');
  assert.equal(lookupQuery({ filename: 'Blue Moon - Evening Song.mp3', title: 'Blue Moon - Evening Song' }), 'Blue Moon - Evening Song', 'an actual full title blocks invented artist hints');
});

test('filename artist extraction handles single-word bands, either order and compact separators', () => {
  const cases = [
    ['Sweet Dreams-Eurythmics-X战警天启快银.mp3', 'Sweet Dreams Eurythmics'],
    ['Theme From Spider Man - Spider-Man.mp3', 'Theme From Spider Man Spider-Man'],
    ['First Class-Henry Jackman.mp3', 'First Class Henry Jackman'],
    ['Mark I - Ramin Djawadi.mp3', 'Mark I Ramin Djawadi'],
    ['Ramin Djawadi-Mark I.mp3', 'Mark I Ramin Djawadi'],
    ['Theme from Ant-Man.mp3', 'Theme from Ant-Man'],
    ['X-Training.mp3', 'X-Training'],
    ['Sweet Dreams - Eurythmics.mp3', 'Sweet Dreams - Eurythmics']
  ];
  for (const [filename, query] of cases) assert.equal(lookupQuery({ filename }), query, filename);
});

test('ambiguous song-artist names use provider fields without promoting invented artist evidence', () => {
  for (const [filename, title, artist] of [
    ['Sweet Dreams-Eurythmics.mp3', 'Sweet Dreams', 'Eurythmics'],
    ['Sweet Dreams - Eurythmics.mp3', 'Sweet Dreams', 'Eurythmics'],
    ['晴天-周杰伦.flac', '晴天', '周杰伦'],
    ['周杰伦-晴天.flac', '晴天', '周杰伦'],
    ['Hello-Adele.mp3', 'Hello', 'Adele'],
    ['Adele-Hello.mp3', 'Hello', 'Adele']
  ]) {
    const local = { filename, duration: 240 };
    const wrong = { id: 'a', title, artist: 'Other Performer', duration: 240 };
    const correct = { id: 'z', title, artist, duration: 240 };
    assert.equal(rankCandidates(local, [wrong, correct])[0].id, 'z', filename);
    assert.equal(isRecommendedCandidate(local, correct), false, 'candidate corroboration is not independent artist evidence');
  }
});

test('whole hyphenated titles outrank speculative filename splits and tagged titles remain authoritative', () => {
  for (const [filename, title, artist, fragment, fragmentArtist] of [
    ['Spider-Man.mp3', 'Spider-Man', 'Composer', 'Spider', 'Man'],
    ['Main Title - Young Peter.mp3', 'Main Title - Young Peter', 'James Horner', 'Main Title', 'Young Peter'],
    ['Theme from Ant-Man.mp3', 'Theme from Ant-Man', 'Christophe Beck', 'Theme from Ant', 'Man']
  ]) {
    const full = { id: 'z', title, artist, duration: 240 };
    const split = { id: 'a', title: fragment, artist: fragmentArtist, duration: 240 };
    assert.equal(rankCandidates({ filename, duration: 240 }, [split, full])[0].id, 'z');
    assert.equal(rankCandidates({ filename, title, duration: 240 }, [split, full])[0].id, 'z');
  }
});

test('ambiguous automatic queries retry separated words while manual queries remain exact', async () => {
  const queries = [];
  const local = { filename: 'Hello-Adele.mp3', duration: 240 };
  const options = { ...opts(async url => {
    const term = new URL(url).searchParams.get('term'); queries.push(term);
    return response({ results: term === 'Hello Adele' ? [{ trackId: 1, trackName: 'Hello', artistName: 'Adele', trackTimeMillis: 240000 }] : [] });
  }), sources: ['itunes'], countries: ['US'], local, autoFilename: true };
  const result = await search('Hello-Adele', options);
  assert.deepEqual(queries, ['Hello-Adele', 'Hello Adele']);
  assert.equal(result.candidates[0].artist, 'Adele');
  queries.length = 0;
  await search('my exact request', options);
  assert.deepEqual(queries, ['my exact request']);
});

test('filename film suffix is not album metadata or ranking evidence', () => {
  const local = { filename: 'Opening Theme-Another Composer-电影配乐.mp3', duration: 240 };
  const unrelatedAlbum = { id: 'a', title: 'Opening Theme', artist: 'Another Composer', album: 'Other Album', duration: 240 };
  const filmAlbum = { ...unrelatedAlbum, id: 'z', album: '电影配乐' };
  assert.equal(scoreCandidate(local, unrelatedAlbum), scoreCandidate(local, filmAlbum));
  assert.deepEqual(rankCandidates(local, [filmAlbum, unrelatedAlbum]).map(c => c.id), ['a', 'z']);
});

test('live version mismatches reduce capped scores and recommendations in both directions', () => {
  for (const liveVersion of ['Live', 'Live Version', 'LiveVersion', '现场版']) {
    for (const field of ['title', 'album']) {
      const local = { filename: 'Opening Theme.mp3', duration: 240, ...(field === 'album' ? { album: 'Studio Album' } : {}) };
      const studio = { title: 'Opening Theme', artist: 'Composer', album: 'Studio Album', duration: 240 };
      const live = { ...studio, [field]: `${studio[field]} (${liveVersion})` };
      const localLive = field === 'title' ? { ...local, filename: `Opening Theme (${liveVersion}).mp3` } : { ...local, album: live.album };
      assert.ok(scoreCandidate(local, studio) > scoreCandidate(local, live), `${field}: studio vs ${liveVersion}`);
      assert.ok(scoreCandidate(localLive, live) > scoreCandidate(localLive, studio), `${field}: ${liveVersion} vs studio`);
      assert.deepEqual(rankCandidates(localLive, [{ ...studio, id: 'a' }, { ...live, id: 'z' }]).map(c => c.id), ['z', 'a']);
      assert.equal(isRecommendedCandidate({ ...local, artist: 'Composer' }, live), false);
      assert.equal(isRecommendedCandidate({ ...localLive, artist: 'Composer' }, studio), false);
    }
  }
});

test('review recommendation never uses bare title and duration as artist evidence', () => {
  const candidate = { title: 'Fanfare', artist: 'Actual Composer', album: 'Film Score', duration: 240 };
  for (const local of [{ title: 'Fanfare', duration: 240 }, { filename: 'Fanfare.mp3', duration: 240 }, { title: 'Fanfare', album: 'Film Score', duration: 240 }]) {
    assert.equal(isRecommendedCandidate(local, candidate), false);
    assert.ok(scoreCandidate(local, candidate) <= 70);
  }
  for (const artist of ['', 'Unknown Artist', 'Various Artists', '未知艺术家']) {
    assert.equal(isRecommendedCandidate({ title: 'Fanfare', artist, duration: 240 }, { ...candidate, artist }), false, artist);
  }
  assert.equal(isRecommendedCandidate({ title: 'Fanfare', artist: 'Actual Composer', duration: 240 }, candidate), true);
  assert.equal(isRecommendedCandidate({ filename: 'Fanfare-Actual Composer-电影配乐.mp3', duration: 240 }, candidate), true);
  assert.equal(isRecommendedCandidate({ filename: 'Fanfare-Actual Composer-电影配乐.mp3', duration: 240 }, { ...candidate, artist: 'Actual Composers' }), false, 'inferred artist needs exact corroboration');
  assert.equal(isRecommendedCandidate({ filename: 'Blue Moon - Silent Night.mp3', duration: 240 }, { title: 'Silent Night', artist: 'Blue Moon', duration: 240 }), false, 'ambiguous separator is not robust artist evidence');
  assert.equal(isRecommendedCandidate({ title: 'Main Title - Young Peter', filename: 'Main Title - Young Peter.mp3', duration: 240 }, { title: 'Main Title - Young Peter', artist: 'Young Peter', duration: 240 }), false);
  assert.equal(scoreCandidate({ title: 'Fanfare', artist: 'Actual Composer', album: 'Film Score', duration: 240 }, { ...candidate, artist: '' }), 70, 'missing candidate artist also limits confidence');
});

test('review recommendation requires close title and measured duration with matching versions', () => {
  const local = { filename: 'Composer - Opening Theme.mp3', duration: 240 };
  const candidate = { title: 'Opening Theme', artist: 'Composer', duration: 240, album: 'Soundtrack' };
  assert.equal(isRecommendedCandidate(local, candidate), true);
  assert.equal(isRecommendedCandidate(local, { ...candidate, duration: 246 }), false);
  assert.equal(isRecommendedCandidate(local, { ...candidate, duration: null }), false);
  assert.equal(isRecommendedCandidate({ ...local, duration: null }, candidate), false);
  assert.equal(isRecommendedCandidate(local, { ...candidate, title: 'Closing Theme' }), false);
  assert.equal(isRecommendedCandidate(local, { ...candidate, artist: 'Someone Else' }), false);
  assert.equal(isRecommendedCandidate(local, { ...candidate, album: 'Live at the Arena' }), false);
  assert.equal(isRecommendedCandidate({ ...local, album: 'Live' }, candidate), false, 'version mismatch is symmetric');
  assert.ok(scoreCandidate({ title: 'Opening Theme', album: 'Live' }, candidate) < 70);
});

test('automatic filename search retries simpler hints and ranks merged results without extra fields', async () => {
  const queries = [];
  const local = { filename: 'Opening Theme-Another Composer-电影配乐 (1).mp3', duration: 240 };
  const result = await search(local.filename, { ...opts(async url => {
    const query = new URL(url).searchParams.get('s'); queries.push(query);
    const songs = query === 'Opening Theme'
      ? [{ id: 2, name: 'Opening Theme', artists: [{ name: 'Another Composer' }], duration: 240000 }]
      : [{ id: 1, name: 'Completely Unrelated', artists: [{ name: 'Someone Else' }], duration: 180000 }];
    return response({ code: 200, result: { songs } });
  }), sources: ['netease'], autoFilename: true, local });
  assert.deepEqual(queries, [local.filename, 'Opening Theme Another Composer', 'Opening Theme']);
  assert.deepEqual(result.candidates.map(c => c.id), ['netease:2', 'netease:1']);
  assert.equal(result.candidates[0].score, 70);
  assert.deepEqual(Object.keys(result.candidates[0]).sort(), ['id', 'source', 'title', 'artist', 'album', 'albumArtist', 'year', 'track', 'disc', 'genre', 'duration', 'coverUrl', 'url', 'score'].sort());
});

test('automatic filename fallback stops on useful matches and manual queries never retry hints', async () => {
  const queries = [];
  const local = { filename: 'Composer - Opening Theme (1).mp3', duration: 240 };
  const options = { ...opts(async url => {
    queries.push(new URL(url).searchParams.get('s'));
    return response({ code: 200, result: { songs: [{ id: 1, name: 'Opening Theme', artists: [{ name: 'Composer' }], duration: 240000 }] } });
  }), sources: ['netease'], local };
  await search(local.filename, { ...options, autoFilename: true });
  assert.deepEqual(queries, [local.filename]);
  queries.length = 0;
  await search('artist:Other AND recording:Different', options);
  assert.deepEqual(queries, ['artist:Other AND recording:Different']);
});

test('filename fallbacks are bounded, deduplicated and preserve explicit manual overrides', async () => {
  const queries = [];
  const local = { filename: 'Opening Theme-Another Composer-电影配乐 (1).mp3', duration: 240 };
  const options = { ...opts(async url => {
    queries.push(new URL(url).searchParams.get('s'));
    return response({ code: 200, result: { songs: [], songCount: 0 } });
  }), sources: ['netease'], local, autoFilename: true, cacheTtlMs: 0 };
  await search(local.filename, options);
  assert.deepEqual(queries, [local.filename, 'Opening Theme Another Composer', 'Opening Theme']);
  queries.length = 0;
  await search(lookupQuery(local), options);
  assert.deepEqual(queries, ['Opening Theme Another Composer', 'Opening Theme'], 'already-clean automatic queries are not repeated');
  queries.length = 0;
  await search('Other Artist Completely Different Song', options);
  assert.deepEqual(queries, ['Other Artist Completely Different Song'], 'a stale automatic flag cannot replace a changed manual query');
  queries.length = 0;
  await search('artist:Other AND recording:Different', options);
  assert.deepEqual(queries, ['artist:Other AND recording:Different']);
  queries.length = 0;
  await search('Plain Title.mp3', { ...options, local: undefined });
  assert.deepEqual(queries, ['Plain Title.mp3', 'Plain Title'], 'automatic local hints can be inferred without a local option');
});

test('search ranks with supplied local evidence while preserving the manual provider query', async () => {
  const queries = [];
  const local = { filename: 'Opening Theme-Another Composer-电影配乐.mp3', duration: 240 };
  const result = await search('manual alternative spelling', { ...opts(async url => {
    queries.push(new URL(url).searchParams.get('s'));
    return response({ code: 200, result: { songs: [
      { id: 1, name: 'Opening Theme', artists: [{ name: 'Different Composer' }], duration: 240000 },
      { id: 2, name: 'Opening Theme', artists: [{ name: 'Another Composer' }], duration: 180000 },
      { id: 3, name: 'Opening Theme', artists: [{ name: 'Another Composer' }], duration: 240000 }
    ] } });
  }), sources: ['netease'], local });
  assert.deepEqual(queries, ['manual alternative spelling']);
  assert.equal(result.candidates[0].id, 'netease:3');
  assert.equal(result.candidates[0].score, 70);
  assert.equal(isRecommendedCandidate(local, result.candidates[0]), true);
  assert.ok(result.candidates.slice(1).every(candidate => !isRecommendedCandidate(local, candidate)));
});

test('automatic fallback retains earlier candidates when a later attempt fails', async () => {
  const local = { filename: 'Opening Theme-Another Composer-电影配乐.mp3', duration: 240 };
  const queries = [];
  const result = await search(local.filename, { ...opts(async url => {
    queries.push(new URL(url).searchParams.get('s'));
    return queries.length === 1
      ? response({ code: 200, result: { songs: [{ id: 1, name: 'Different Song', artists: [{ name: 'Someone Else' }], duration: 180000 }] } })
      : response({}, 403);
  }), sources: ['netease'], local, autoFilename: true });
  assert.equal(queries.length, 2);
  assert.deepEqual(result.candidates.map(candidate => candidate.id), ['netease:1']);
  assert.deepEqual(result.errors.map(error => error.code), ['BLOCKED']);
});

test('host throttle spaces requests and waiting callers can abort promptly', async () => {
  const times = [];
  await search('test', { ...opts(async () => { times.push(Date.now()); return response({ results: [] }); }), throttleMs: 70, sources: ['itunes'], countries: ['CN', 'JP', 'US'] });
  assert.equal(times.length, 3);
  assert.ok(times[1] - times[0] >= 55, `${times[1] - times[0]} ms`);
  assert.ok(times[2] - times[1] >= 55, `${times[2] - times[1]} ms`);
  const controller = new AbortController();
  const pending = search('test', { ...opts(async () => { throw new Error('Should not fetch'); }), sources: ['itunes'], signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
});
