'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), path = require('node:path'), os = require('node:os');
const service = require('../source/core/lyric-service.cjs');
const lyrics = '[00:01.00]First\n[00:03.00]Second';
const json = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
test('online NetEase ID fetches exact metadata and lyrics without keyword search, covers or local paths', async () => {
  const urls = [];
  const fetch = async url => {
    urls.push(String(url));
    if (String(url).includes('/api/song/detail/')) return json({ code: 200, songs: [{ id: 123, name: '在线歌曲', artists: [{ name: '歌手' }], album: { name: '专辑' }, duration: 125000 }] });
    return json({ code: 200, lrc: { lyric: lyrics }, tlyric: { lyric: '[00:01.00]第一句' } });
  };
  const result = await service.resolve('https://music.163.com/#/song?id=123', { fetch, throttleMs: 0, retries: 0 });
  assert.equal(result.candidate.id, 'netease:123'); assert.equal(result.candidate.title, '在线歌曲'); assert.equal(result.candidate.duration, 125);
  assert.equal(result.original, lyrics); assert.match(result.translated, /第一句/); assert.deepEqual(result.errors, []);
  assert.equal(urls.length, 2); assert.ok(urls.every(url => url.startsWith('https://music.163.com/api/song/')));
  assert.equal(new URL(urls[1]).searchParams.get('id'), '123');
});
test('QQ numeric ID and MID use distinct exact song parameters', async () => {
  for (const key of ['456', '003OUlho2HcRHC']) {
    const urls = [];
    const fetch = async url => {
      urls.push(new URL(url));
      if (String(url).includes('fcg_play_single_song')) return json({ code: 0, data: [{ id: 456, mid: '003OUlho2HcRHC', name: 'Song &amp; title', singer: [{ name: 'Singer' }], album: { name: 'Album' }, interval: 120 }] });
      return json({ code: 0, lyric: lyrics, trans: '[00:01.00]译文' });
    };
    const result = await service.resolve('qq:' + key, { fetch, throttleMs: 0, retries: 0 });
    assert.equal(result.candidate.id, 'qq:' + key); assert.equal(result.candidate.title, 'Song & title'); assert.equal(result.original, lyrics);
    assert.equal(urls.length, 2);
    assert.equal(urls[0].searchParams.get(/^\d+$/.test(key) ? 'songid' : 'songmid'), key);
    assert.equal(urls[1].searchParams.get(/^\d+$/.test(key) ? 'musicid' : 'songmid'), key);
  }
});
test('detail failures preserve the exact song identity and still retrieve lyrics', async () => {
  for (const detail of [{ code: 404 }, { code: 200, songs: [{ id: 999, name: 'Wrong song' }] }]) {
    const result = await service.resolve('netease:123', { fetch: async url => String(url).includes('/detail/') ? json(detail) : json({ code: 200, lrc: { lyric: lyrics } }), throttleMs: 0, retries: 0 });
    assert.equal(result.candidate.id, 'netease:123'); assert.equal(result.candidate.title, '网易云音乐 123'); assert.equal(result.original, lyrics); assert.equal(result.errors.length, 1);
  }
});
test('online exports require a directory, use song metadata filenames and preserve existing files', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'music-tools-online-'));
  try {
    const job = { original: lyrics, translated: '[00:01]第一句', metadata: { title: '线上歌曲', artist: '歌手' }, options: { filenameTemplate: '{title} - {artist}', format: 'srt', bilingualMode: 'separate' } };
    await assert.rejects(service.exportLyrics(job), /选择.*目录/);
    assert.deepEqual(service.filenames(job).filenames, ['线上歌曲 - 歌手.original.srt', '线上歌曲 - 歌手.translation.srt']);
    const first = await service.exportLyrics({ ...job, directory }), second = await service.exportLyrics({ ...job, directory });
    assert.equal(first.files.length, 2); assert.match(second.path, /\(1\)\.srt$/);
    assert.match(await fs.readFile(first.path, 'utf8'), /00:00:01,000/);
    assert.equal((await fs.readdir(directory)).length, 4);
    assert.deepEqual(service.filenames({ metadata: { title: 'A.B' } }).filenames, ['A.B.srt']);
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});
test('already canceled reference makes no network requests', async () => {
  const controller = new AbortController(); controller.abort(); let count = 0;
  await assert.rejects(service.resolve('netease:123', { signal: controller.signal, fetch: async () => { count++; throw new Error('unexpected'); } }), { name: 'AbortError' });
  assert.equal(count, 0);
});
