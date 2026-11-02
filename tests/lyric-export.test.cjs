'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { parseLrc, convertLyrics, safeWindowsBasename, renderFilename, saveLyric, writeLyricFile } = require('../source/core/lyric-export.cjs');

async function fixture(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'music-tools-lyrics-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}
const starts = result => result.cues.map(cue => cue.startMs);

test('default SRT uses CRLF, numbered cues, millisecond precision and bilingual stable ordering', () => {
  const result = convertLyrics('[00:02.123]原文二\n[00:01.00]原文一\n[00:01.00]另一行\n[00:01.00]原文一', '[00:01.000]Translation one\n[00:02.123]Translation two', { duration: 4 });
  assert.equal(result.format, 'srt');
  assert.deepEqual(starts(result), [1000, 2123]);
  assert.deepEqual(result.cues.map(cue => cue.endMs), [2123, 4000]);
  assert.equal(result.cues[0].text, '原文一\n另一行\nTranslation one');
  assert.equal(result.text, '1\r\n00:00:01,000 --> 00:00:02,123\r\n原文一\r\n另一行\r\nTranslation one\r\n\r\n2\r\n00:00:02,123 --> 00:00:04,000\r\n原文二\r\nTranslation two\r\n');
  assert.equal(result.warnings.length, 0);
});

test('inline bilingual style has an adjustable separator across SRT, LRC and TXT', () => {
  for (const format of ['srt', 'lrc', 'txt']) {
    const result = convertLyrics('[00:01]原文', '[00:01]Translation', { format, bilingualMode: 'inline', duration: 2 });
    assert.equal(result.bilingualMode, 'inline');
    assert.equal(result.cues[0].text, '原文 / Translation');
    assert.match(result.text, /原文 \/ Translation/);
    const custom = convertLyrics('[00:01]原文', '[00:01]Translation', { format, bilingualMode: 'inline', separator: ' · ', duration: 2 });
    assert.match(custom.text, /原文 · Translation/);
  }
  assert.throws(() => convertLyrics('[00:01]a', '', { bilingualMode: 'other' }), { code: 'INVALID_OPTIONS' });
  assert.throws(() => convertLyrics('[00:01]a', '', { bilingualMode: 'inline', separator: '\n' }), { code: 'INVALID_OPTIONS' });
});

test('independent bilingual cues intentionally share intervals with stable sequential numbering', () => {
  const result = convertLyrics('[00:01]原文一\n[00:03]原文二', '[00:01]Translation one\n[00:03]Translation two', { bilingualMode: 'cues', duration: 5 });
  assert.deepEqual(result.cues.map(({ startMs, endMs, channel, text }) => [startMs, endMs, channel, text]), [
    [1000, 3000, 'original', '原文一'], [1000, 3000, 'translation', 'Translation one'],
    [3000, 5000, 'original', '原文二'], [3000, 5000, 'translation', 'Translation two']
  ]);
  assert.deepEqual([...result.text.matchAll(/(?:^|\r\n\r\n)(\d+)\r\n/g)].map(match => Number(match[1])), [1, 2, 3, 4]);
  assert.match(result.warnings.join(' '), /独立字幕条目.*重叠/);
  const originalOnly = convertLyrics('[00:01]原文', '[00:01]Translation', { layout: 'original', bilingualMode: 'cues', duration: 2 });
  assert.equal(originalOnly.cues.length, 1);
  assert.equal(originalOnly.cues[0].text, '原文');
  assert.equal(originalOnly.warnings.length, 0);
});

test('multiple line stamps, BOM, enhanced word stamps and metadata are normalized', () => {
  const parsed = parseLrc('\uFEFF[ar:Artist]\r\n[ti:Title]\r\n[00:01.2][00:03.45]<00:01.20>Hello <00:01.50>world');
  assert.deepEqual(parsed.events.map(({ startMs, text }) => [startMs, text]), [[1200, 'Hello world'], [3450, 'Hello world']]);
  assert.deepEqual(parsed.plainLines, []);
  assert.equal(convertLyrics('[00:01]<00:01>hi<00:02> there', '', { layout: 'original' }).cues[0].text, 'hi there');
});

test('last offset headers apply globally and offsets delay both languages plus translation adjustment', () => {
  const result = convertLyrics('[offset:100]\n[00:01]原文\n[offset:-200]', '[offset:+300]\n[00:01]Translation', { offsetMs: 500, translationOffsetMs: -500, duration: 3 });
  assert.deepEqual(starts(result), [1300]);
  assert.equal(result.cues[0].text, '原文\nTranslation');
  assert.equal(parseLrc('[offset:10]\n[offset:20]\n[00:01]a').offsetMs, 20);
});

test('blank timed lines establish silence boundaries including a trailing closing boundary', () => {
  const result = convertLyrics('[00:01]first\n[00:02]\n[00:10]second\n[00:12]', '', { layout: 'original' });
  assert.deepEqual(result.cues.map(cue => [cue.startMs, cue.endMs]), [[1000, 2000], [10000, 12000]]);
  assert.equal(result.warnings.length, 0);
  const lrc = convertLyrics('[00:01]first\n[00:02]\n[00:10]second\n[00:12]', '', { format: 'lrc', layout: 'original' });
  assert.match(lrc.text, /\[00:02\.000\]\r\n/);
});

test('long gaps retain supplied timestamps; final unknown duration uses the target app three-second fallback', () => {
  const result = convertLyrics('[00:01]first\n[00:45]last', '', { layout: 'original' });
  assert.equal(result.cues[0].endMs, 45000);
  assert.equal(result.cues[1].endMs, 48000);
  assert.match(result.warnings.join(' '), /3 秒/);
});

test('hours do not wrap and known duration determines the final cue even when long', () => {
  const result = convertLyrics('[65:01.250]long\n[1:06:00.123]later', '', { layout: 'original', duration: 4000 });
  assert.equal(result.cues[0].startMs, 3901250);
  assert.match(result.text, /01:05:01,250 --> 01:06:00,123/);
  assert.match(result.text, /01:06:00,123 --> 01:06:40,000/);
  assert.equal(result.warnings.length, 0);
});

test('negative offsets clamp safely, repeated clamped starts merge, duration clips output', () => {
  const result = convertLyrics('[00:00.100]a\n[00:00.200]b\n[00:02]c\n[00:03]outside', '', { layout: 'original', offsetMs: -500, durationMs: 2000 });
  assert.deepEqual(result.cues.map(cue => [cue.startMs, cue.endMs, cue.text]), [[0, 1500, 'a\nb'], [1500, 2000, 'c']]);
  assert.match(result.warnings.join(' '), /调整为零/);
  assert.match(result.warnings.join(' '), /歌曲时长/);
});

test('original and translation layouts select only their own text and timeline', () => {
  const original = '[00:01]original\n[00:03]original two';
  const translated = '[00:01.2]translated\n[00:04]translated two';
  const a = convertLyrics(original, translated, { layout: 'original', duration: 5 });
  const b = convertLyrics(original, translated, { layout: 'translation', duration: 5 });
  assert.deepEqual(starts(a), [1000, 3000]);
  assert.deepEqual(starts(b), [1200, 4000]);
  assert.doesNotMatch(a.text, /translated/);
  assert.doesNotMatch(b.text, /original/);
  const both = convertLyrics(original, translated, { duration: 5 });
  assert.ok(both.cues.every((cue, i) => cue.endMs > cue.startMs && (!i || both.cues[i - 1].endMs <= cue.startMs)));
});

test('plain lyrics never acquire invented timestamps; TXT retains both language blocks', () => {
  assert.throws(() => convertLyrics('Hello\nworld'), { code: 'UNSYNCED_LYRICS' });
  assert.throws(() => convertLyrics('Hello', '', { format: 'lrc' }), { code: 'UNSYNCED_LYRICS' });
  assert.throws(() => convertLyrics('[00:01]hello', '你好', { layout: 'translation' }), { code: 'UNSYNCED_LYRICS' });
  const result = convertLyrics('Hello\nworld', '你好\n世界', { format: 'txt' });
  assert.equal(result.text, 'Hello\r\nworld\r\n\r\n你好\r\n世界\r\n');
  assert.deepEqual(result.cues, []);
  assert.equal(result.timed, false);
  assert.match(result.warnings.join(' '), /分段导出/);
});

test('timed original with untimed translation omits unaligned text with a warning', () => {
  const result = convertLyrics('[00:01]hello', '你好', { duration: 2 });
  assert.equal(result.cues[0].text, 'hello');
  assert.match(result.warnings.join(' '), /无法自动生成时间/);
});

test('LRC and TXT preserve normalized simultaneous content without duplicate lines', () => {
  const result = convertLyrics('[00:01]same\n[00:02]two\n[00:03]', '[00:01]same\n[00:02]二', { format: 'lrc' });
  assert.equal(result.text, '[00:01.000]same\r\n[00:02.000]two\r\n[00:02.000]二\r\n[00:03.000]\r\n');
  const txt = convertLyrics('[00:01]one\n[00:02]two', '[00:01]一\n[00:02]二', { format: 'txt', duration: 3 });
  assert.equal(txt.text, 'one\r\n一\r\ntwo\r\n二\r\n');
});

test('invalid options, missing selected lyrics, malformed timestamps and encrypted blobs reject clearly', () => {
  for (const options of [{ format: 'ass' }, { layout: 'other' }, { offsetMs: NaN }, { translationOffsetMs: Infinity }, { duration: -1 }, { durationMs: 0 }]) assert.throws(() => convertLyrics('[00:01]a', '', options));
  assert.throws(() => convertLyrics('', ''), { code: 'NO_LYRICS' });
  assert.throws(() => convertLyrics('[00:01]a', '', { layout: 'translation' }), { code: 'NO_LYRICS' });
  assert.throws(() => convertLyrics('012345ABCDEF'), { code: 'UNSYNCED_LYRICS' });
  assert.throws(() => convertLyrics('[00:99]bad'), { code: 'NO_LYRICS' });
  assert.throws(() => convertLyrics('[1000,2000]QRC(1000,1000)'), { code: 'NO_LYRICS' });
  assert.deepEqual(parseLrc('literal [brackets]\n[00:01]line [not a timestamp]').plainLines, ['literal [brackets]']);
});

test('safe filenames handle traversal characters, reserved Windows devices and Unicode lengths', () => {
  assert.equal(safeWindowsBasename('../CON:hello?. '), '.._CON_hello_');
  assert.equal(safeWindowsBasename('CON'), '_CON');
  assert.equal(safeWindowsBasename('LPT1.extra'), '_LPT1.extra');
  assert.equal(safeWindowsBasename('CON .txt'), '_CON .txt');
  assert.equal(safeWindowsBasename('..'), 'lyrics');
  assert.equal(safeWindowsBasename('中文歌曲'), '中文歌曲');
  const value = safeWindowsBasename('😀'.repeat(100));
  assert.equal(value.length, 160);
  assert.equal(Array.from(value).length, 80);
});

test('filename templates whitelist tokens, provide fallbacks, sanitize metadata and preserve safe suffixes', () => {
  const audioPath = 'C:\\Music\\Original Song.flac';
  assert.equal(renderFilename({ audioPath }), 'Original Song');
  assert.equal(renderFilename({ audioPath, filenameTemplate: '{title}-{artist}', metadata: { title: '歌曲', artist: '歌手' } }), '歌曲-歌手');
  assert.equal(renderFilename({ audioPath, filenameTemplate: '{title}-{artist}-{album}-{track}-{source}' }), 'Original Song-未知艺术家-未知专辑-未知序号-未知来源');
  assert.equal(renderFilename({ audioPath, filenameTemplate: '{title}-{artist}', metadata: { title: '../CON:?', artist: '歌/手' }, suffix: '.translation' }), '.._CON__-歌_手.translation');
  assert.equal(renderFilename({ audioPath, filenameTemplate: '{filename}-{track}-{source}', metadata: { track: 2, source: 'qq' }, suffix: '.original' }), 'Original Song-2-qq.original');
  for (const filenameTemplate of ['{unknown}', '{{title}}', '{title', 'title}', '']) assert.throws(() => renderFilename({ audioPath, filenameTemplate }), { code: 'INVALID_TEMPLATE' });
  assert.throws(() => renderFilename({ audioPath, suffix: '/../escape' }), { code: 'INVALID_FILENAME' });
  assert.throws(() => renderFilename({ audioPath, filenameTemplate: '{title}', metadata: { title: {} } }), { code: 'INVALID_TEMPLATE' });
  assert.ok(renderFilename({ audioPath, metadata: { title: '😀'.repeat(200) }, filenameTemplate: '{title}', suffix: '.translation' }).endsWith('.translation'));
});

test('separate-language export suffixes and templated names remain collision-safe', async t => {
  const directory = await fixture(t);
  const common = { audioPath: 'song.mp3', directory, filenameTemplate: '{title}-{artist}', metadata: { title: '歌曲', artist: '歌手' } };
  const original = await saveLyric({ ...common, text: '原文', suffix: '.original' });
  const translation = await saveLyric({ ...common, text: '译文', suffix: '.translation', format: 'lrc' });
  const duplicate = await saveLyric({ ...common, text: '另一份', suffix: '.original' });
  assert.equal(original.filename, '歌曲-歌手.original.srt');
  assert.equal(translation.filename, '歌曲-歌手.translation.lrc');
  assert.equal(duplicate.filename, '歌曲-歌手.original (1).srt');
  assert.equal(await fs.readFile(original.path, 'utf8'), '原文');
  assert.equal(await fs.readFile(translation.path, 'utf8'), '译文');
  await assert.rejects(saveLyric({ ...common, text: 'x', filenameTemplate: '{bad}' }), { code: 'INVALID_TEMPLATE' });
});

test('UTF-8 export matches the audio stem and never changes audio bytes', async t => {
  const directory = await fixture(t);
  const audioPath = path.join(directory, '歌手 - 歌曲.flac');
  const audio = Buffer.from([0, 1, 2, 255]);
  await fs.writeFile(audioPath, audio);
  const text = convertLyrics('[00:01]歌词', '', { layout: 'original', duration: 2 }).text;
  const result = await saveLyric({ audioPath, directory, text });
  assert.equal(result.filename, '歌手 - 歌曲.srt');
  assert.equal(result.bytes, Buffer.byteLength(text));
  assert.equal(await fs.readFile(result.path, 'utf8'), text);
  assert.deepEqual(await fs.readFile(audioPath), audio);
  assert.equal(writeLyricFile, saveLyric);
});

test('existing and concurrent same-name exports get unique exclusive numbered suffixes', async t => {
  const directory = await fixture(t);
  await fs.writeFile(path.join(directory, 'Song.srt'), 'keep existing');
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) => saveLyric({ audioPath: `C:\\album-${i}\\Song.mp3`, directory, text: `lyric ${i}` })));
  assert.equal(new Set(results.map(result => result.path)).size, 12);
  assert.equal(await fs.readFile(path.join(directory, 'Song.srt'), 'utf8'), 'keep existing');
  for (const [i, result] of results.entries()) assert.equal(await fs.readFile(result.path, 'utf8'), `lyric ${i}`);
  assert.ok(results.some(result => result.filename === 'Song (12).srt'));
});

test('explicit overwrite replaces a lyric hardlink instead of modifying the audio inode', async t => {
  const directory = await fixture(t);
  const audioPath = path.join(directory, 'song.mp3');
  const target = path.join(directory, 'song.srt');
  await fs.writeFile(audioPath, 'audio remains');
  await fs.link(audioPath, target);
  const result = await saveLyric({ audioPath, directory, text: 'new subtitles', overwrite: true });
  assert.equal(result.path, target);
  assert.equal(await fs.readFile(target, 'utf8'), 'new subtitles');
  assert.equal(await fs.readFile(audioPath, 'utf8'), 'audio remains');
  assert.deepEqual((await fs.readdir(directory)).sort(), ['song.mp3', 'song.srt']);
});

test('pre-cancelled export writes no files and unsafe/same-audio paths reject', async t => {
  const directory = await fixture(t);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(saveLyric({ audioPath: 'song.mp3', directory, text: 'x', signal: controller.signal }), { name: 'AbortError' });
  await assert.rejects(saveLyric({ audioPath: 'song.mp3', directory: '..', text: 'x' }), { code: 'INVALID_DIRECTORY' });
  await assert.rejects(saveLyric({ audioPath: path.join(directory, 'song.srt'), directory, text: 'x', overwrite: true }), { code: 'AUDIO_PATH_CONFLICT' });
  await assert.rejects(saveLyric({ audioPath: 'song.mp3', directory, text: '' }), { code: 'NO_LYRICS' });
  assert.deepEqual(await fs.readdir(directory), []);
});

test('cancellation after a partial write removes only the new export and preserves an existing overwrite target', async t => {
  const directory = await fixture(t);
  const target = path.join(directory, 'song.srt');
  const realOpen = fs.open.bind(fs);
  let controller;
  t.mock.method(fs, 'open', async (...args) => {
    const handle = await realOpen(...args);
    const realWrite = handle.writeFile.bind(handle);
    t.mock.method(handle, 'writeFile', async (text, options) => {
      await realWrite(text.slice(0, 3), 'utf8');
      controller.abort();
      return realWrite(text.slice(3), options);
    });
    return handle;
  });
  controller = new AbortController();
  await assert.rejects(saveLyric({ audioPath: 'song.mp3', directory, text: 'partial lyric', signal: controller.signal }), { name: 'AbortError' });
  assert.deepEqual(await fs.readdir(directory), []);
  await fs.writeFile(target, 'original lyric');
  controller = new AbortController();
  await assert.rejects(saveLyric({ audioPath: 'song.mp3', directory, text: 'partial overwrite', overwrite: true, signal: controller.signal }), { name: 'AbortError' });
  assert.equal(await fs.readFile(target, 'utf8'), 'original lyric');
  assert.deepEqual(await fs.readdir(directory), ['song.srt']);
});

test('output folder links and ancestor junctions reject without writing outside the selected directory', async t => {
  const directory = await fixture(t);
  const outside = path.join(directory, 'outside');
  const link = path.join(directory, 'link');
  await fs.mkdir(outside);
  await fs.mkdir(path.join(outside, 'nested'));
  await fs.symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  for (const selected of [link, path.join(link, 'nested')]) await assert.rejects(saveLyric({ audioPath: 'song.mp3', directory: selected, text: 'x' }), { code: 'UNSAFE_DIRECTORY' });
  assert.deepEqual(await fs.readdir(outside), ['nested']);
});

test('a linked output filename is preserved by default and rejected for explicit overwrite', async t => {
  const directory = await fixture(t);
  const real = path.join(directory, 'real');
  const linked = path.join(directory, 'song.srt');
  await fs.mkdir(real);
  // Directory junctions are available without Windows symlink privileges and must never be followed.
  await fs.symlink(real, linked, process.platform === 'win32' ? 'junction' : 'dir');
  const saved = await saveLyric({ audioPath: 'song.mp3', directory, text: 'safe' });
  assert.equal(saved.filename, 'song (1).srt');
  await assert.rejects(saveLyric({ audioPath: 'song.mp3', directory, text: 'unsafe', overwrite: true }), { code: 'UNSAFE_FILE' });
  assert.deepEqual(await fs.readdir(real), []);
});
