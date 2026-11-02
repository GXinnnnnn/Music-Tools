'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const service = require('../source/core/lyric-service.cjs');
const providers = require('../source/core/providers.cjs');
const candidate = { id: 'qq:good', source: 'qq', title: 'Song', artist: 'Artist', album: 'Album', duration: 120, score: 99 };
const original = '[00:01.00]First\n[00:03.00]Second\n[00:05.00]';

test('lyric service validates sources/candidates and limits local search hints', () => {
  assert.deepEqual(service.sourceOptions(['netease', 'qq']), ['qq', 'netease']);
  assert.throws(() => service.sourceOptions([]));
  assert.throws(() => service.sourceOptions(['itunes']));
  assert.throws(() => service.candidateInfo({ ...candidate, id: 'https://unexpected.invalid' }));
  assert.throws(() => service.candidateInfo({ ...candidate, source: 'netease', id: 'netease:evil' }));
  assert.deepEqual(service.localInfo({ path: 'C:\\private\\Song.mp3', duration: 120, tags: { title: 'Song', artist: 'Artist', lyrics: 'private lyrics' } }),
    { title: 'Song', artist: 'Artist', album: '', duration: 120, filename: 'Song.mp3' });
});

test('lyric-only provider requests do not silently substitute LRCLIB or download covers', async () => {
  const urls = [];
  const fetch = async url => { urls.push(String(url)); return new Response(JSON.stringify({ code: -1, message: 'blocked' }), { status: 200 }); };
  const result = await service.fetchLyrics(candidate, { fetch, throttleMs: 0, retries: 0 });
  assert.equal(result.original, '');
  assert.ok(result.errors.length);
  assert.equal(urls.length, 1);
  assert.match(urls[0], /^https:\/\/c\.y\.qq\.com\/lyric\//);
  assert.ok(!urls.some(url => /lrclib|gtimg|cover/.test(url)));
});

test('NetEase extracts original and translation directly for SRT preview', async () => {
  const urls = [];
  const fetch = async url => { urls.push(String(url)); return new Response(JSON.stringify({ code: 200, lrc: { lyric: original }, tlyric: { lyric: '[00:01.00]第一句\n[00:03.00]第二句' } }), { status: 200 }); };
  const data = await service.fetchLyrics({ ...candidate, source: 'netease', id: 'netease:123' }, { fetch, throttleMs: 0, retries: 0 });
  const preview = service.preview(data);
  assert.equal(preview.format, 'srt');
  assert.match(preview.text, /00:00:01,000 --> 00:00:03,000/);
  assert.match(preview.text, /第一句/);
  assert.equal(urls.length, 1);
});

test('batch exports strong identities, keeps ambiguous and missing songs for review, preserves audio', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'music-tools-lyrics-service-'));
  const saved = { search: providers.search, enrich: providers.enrich };
  const progress = [];
  try {
    const jobs = [];
    for (const [name, artist] of [['Song', 'Artist'], ['Ambiguous', 'Artist Collective'], ['Unknown', ''], ['Missing', 'Artist']]) {
      const audioPath = path.join(directory, name + '.mp3');
      await fs.writeFile(audioPath, 'untouched audio bytes');
      jobs.push({ path: audioPath, local: { filename: name + '.mp3', duration: 120, tags: { title: name, artist } } });
    }
    providers.search = async (query, options) => {
      assert.deepEqual(options.fields, ['lyrics']);
      assert.equal(options.artwork, false);
      assert.ok(!query.includes(directory));
      const title = options.local.title;
      if (title === 'Missing') return { candidates: [], errors: [] };
      const first = { ...candidate, title, artist: options.local.artist || 'Artist' };
      return { candidates: title === 'Ambiguous' ? [first, { ...first, id: 'netease:42', source: 'netease', artist: 'Artist Collectives', score: 98 }] : [first], errors: [] };
    };
    providers.enrich = async (c, options) => { assert.equal(options.lyricsFallback, false); return { ...c, lyrics: original, syncedLyrics: original, errors: [] }; };
    const result = await service.batch(jobs, { sources: ['qq', 'netease'], onProgress: row => progress.push(row) });
    assert.equal(result.canceled, false);
    assert.equal(result.results[0].status, 'exported');
    assert.equal(result.results[1].status, 'review');
    assert.equal(result.results[2].status, 'review');
    assert.equal(result.results[3].status, 'no_match');
    assert.match(await fs.readFile(result.results[0].output, 'utf8'), /00:00:01,000/);
    assert.equal(progress.length, jobs.length);
    assert.deepEqual(result.results.map(row => row.path), jobs.map(job => job.path));
    for (const job of jobs) assert.equal(await fs.readFile(job.path, 'utf8'), 'untouched audio bytes');
  } finally { Object.assign(providers, saved); await fs.rm(directory, { recursive: true, force: true }); }
});

test('format, bilingual arrangement and filename controls are preserved across separate exports', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'music-tools-lyric-options-'));
  try {
    const audioPath = path.join(directory, 'untouched.mp3');
    await fs.writeFile(audioPath, 'audio content');
    for (const format of ['srt', 'lrc', 'txt']) {
      const options = { format, layout: 'bilingual', bilingualMode: 'separate', filenameTemplate: '{title} - {artist}' };
      const job = { audioPath, original, translated: '[00:01.00]第一句\n[00:03.00]第二句', metadata: { title: '歌曲', artist: '歌手' }, options };
      assert.deepEqual(service.filenames(job).filenames, [`歌曲 - 歌手.original.${format}`, `歌曲 - 歌手.translation.${format}`]);
      const preview = service.preview(job, options);
      assert.equal(preview.files.length, 2);
      assert.match(preview.text, /原文文件/);
      const saved = await service.exportLyrics(job);
      assert.equal(saved.files.length, 2);
      const a = await fs.readFile(saved.files[0].path, 'utf8'), b = await fs.readFile(saved.files[1].path, 'utf8');
      assert.match(a, /First/); assert.ok(!a.includes('第一句'));
      assert.match(b, /第一句/); assert.ok(!b.includes('First'));
      assert.deepEqual(saved.files.map(file => file.filename), service.filenames(job).filenames);
    }
    assert.equal(await fs.readFile(audioPath, 'utf8'), 'audio content');
    const noTranslation = service.preview({ original }, { bilingualMode: 'separate' });
    assert.equal(noTranslation.files.length, 1); assert.match(noTranslation.warnings.join(' '), /没有译文/);
    const inline = service.preview({ original, translated: '[00:01.00]第一句' }, { bilingualMode: 'inline', separator: ' · ' });
    assert.match(inline.text, /First · 第一句/);
    const cues = service.preview({ original, translated: '[00:01.00]第一句' }, { bilingualMode: 'cues' });
    assert.equal(cues.cues.length, 3);
    assert.equal(cues.cues[0].startMs, cues.cues[1].startMs);
    assert.throws(() => service.filenames({ audioPath, options: { filenameTemplate: '{invalid}' } }));
    assert.throws(() => service.conversionOptions({ bilingualMode: 'invalid' }));
  } finally { await fs.rm(directory, { recursive: true, force: true }); }
});

test('already canceled batch makes no requests and accounts for every queued row', async () => {
  const controller = new AbortController(); controller.abort();
  const result = await service.batch([{ path: 'a.mp3' }, { path: 'b.mp3' }], { signal: controller.signal });
  assert.equal(result.canceled, true);
  assert.deepEqual(result.results.map(row => row.status), ['canceled', 'canceled']);
});
