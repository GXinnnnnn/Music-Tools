'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { tagsFromFilename, cleanLyrics, replaceTags, clearTags, convertChinese, convertTags, layoutLyrics } = require('../source/core/text-tools.cjs');

test('filename parser strips supported audio extensions and handles Windows or POSIX paths', () => {
  assert.deepEqual(tagsFromFilename('C:\\Music\\坂本龍一 - Merry Christmas.MP3'), { artist: '坂本龍一', title: 'Merry Christmas' });
  assert.deepEqual(tagsFromFilename('/music/Artist - Song.live.flac'), { artist: 'Artist', title: 'Song.live' });
  assert.deepEqual(tagsFromFilename('Artist - Notes.txt'), { artist: 'Artist', title: 'Notes.txt' });
});

test('filename templates support every documented field and escape literal regex characters', () => {
  const template = '[{year}] {albumArtist} + {artist} - {album} ({disc}.{track}) {title} [{comment}]';
  assert.deepEqual(tagsFromFilename('[2024] Various + Singer - Record (2.03) Song [Live].m4a', template), {
    title: 'Song', artist: 'Singer', album: 'Record', albumArtist: 'Various', track: '03', disc: '2', year: '2024', comment: 'Live'
  });
});

test('filename regex mode supports named captures and placeholders', () => {
  assert.deepEqual(tagsFromFilename('07 Artist_Song.opus', '(?<track>\\d{2}) (?<artist>[^_]+)_(?<title>.+)', true), {
    title: 'Song', artist: 'Artist', track: '07'
  });
  assert.deepEqual(tagsFromFilename('Artist___Song.wav', '{artist}_+{title}', true), { artist: 'Artist', title: 'Song' });
});

test('filename parser clearly rejects mismatches, invalid templates and empty captures', () => {
  assert.throws(() => tagsFromFilename('Song.mp3'), /does not match/);
  assert.throws(() => tagsFromFilename('Artist - Song.mp3', '{unknown}'), /Unsupported filename placeholder/);
  assert.throws(() => tagsFromFilename('Artist - Song.mp3', '{artist} - {artist}'), /Duplicate filename placeholder/);
  assert.throws(() => tagsFromFilename('Song.mp3', '(?<title>[)', true), /Invalid filename template/);
  assert.throws(() => tagsFromFilename('Song.mp3', 'Song'), /must contain/);
  assert.throws(() => tagsFromFilename('Artist -   .mp3'), /empty title/);
});

test('lyrics preserve all timestamps and metadata by default', () => {
  const lyrics = '[ar:Artist]\n[offset:250]\n[0:01.2][00:12.345]Same line\n[Chorus]\n';
  assert.equal(cleanLyrics(lyrics), lyrics);
  assert.equal(cleanLyrics('a\r\nb\rc'), 'a\nb\nc');
});

test('lyrics strip multiple timestamps, metadata and blank lines independently', () => {
  const lyrics = '[ar:Singer]\r\n[ti:Song]\r\n[00:01.20][00:04.300]Hello\r\n  \r\n[Chorus]\r\n';
  assert.equal(cleanLyrics(lyrics, { stripTimes: true, stripMetadata: true, removeBlank: true }), 'Hello\n[Chorus]');
  assert.equal(cleanLyrics('[ar:Singer]\n[00:01.00]Hello', { stripTimes: true }), '[ar:Singer]\nHello');
});

test('lyrics shift every timestamp, carry across minutes and clamp negative times', () => {
  assert.equal(cleanLyrics('[00:59.900][01:00.000]Line', { offsetMs: 250 }), '[01:00.150][01:00.250]Line');
  assert.equal(cleanLyrics('[00:00.100][00:02.000]Line', { offsetMs: -200 }), '[00:00.000][00:01.800]Line');
});

test('lyrics bake existing LRC offset into shifted times once', () => {
  const cleaned = cleanLyrics('[offset:500]\n[00:01.000][00:02.000]Line', { offsetMs: 250, removeBlank: true });
  assert.equal(cleaned, '[00:01.750][00:02.750]Line');
  assert.equal(cleanLyrics(cleaned), cleaned);
  assert.equal(cleanLyrics('[offset:-200]\n[00:01.000]Line', { stripMetadata: true, removeBlank: true }), '[00:00.800]Line');
});

test('lyrics format timestamps with millisecond precision and support hour timestamps', () => {
  assert.equal(cleanLyrics('[1:02][01:02.3][01:02:03.045]Line', { formatTimes: true }), '[01:02.000][01:02.300][62:03.045]Line');
  assert.equal(cleanLyrics('[offset:100]\n[0:01.25]Line', { formatTimes: true, removeBlank: true }), '[00:01.350]Line');
  assert.throws(() => cleanLyrics('Line', { offsetMs: NaN }), /finite number/);
});

test('lyrics reject timestamp and offset arithmetic beyond safe integer precision', () => {
  assert.throws(() => cleanLyrics('[9999999999999999:00]Line', { formatTimes: true }), /safe millisecond range/);
  assert.throws(() => cleanLyrics('[offset:9999999999999999999]\n[00:01]Line', { formatTimes: true }), /safe millisecond range/);
  assert.throws(() => cleanLyrics('[00:01]Line', { offsetMs: 1e308 }), /safe millisecond range/);
});

test('tag replacement returns a changed-fields patch without mutating source', () => {
  const tags = Object.freeze({ title: 'Hello HELLO', artist: 'Hello', year: 2024 });
  assert.deepEqual(replaceTags(tags, { find: 'hello', replace: 'Hi', fields: ['title'] }), { title: 'Hi Hi' });
  assert.equal(tags.title, 'Hello HELLO');
  assert.deepEqual(replaceTags(tags, { find: 'hello', replace: 'Hi', caseSensitive: true }), {});
  assert.deepEqual(replaceTags(tags, { find: 'missing', replace: 'Hi' }), {});
});

test('literal replacement escapes metacharacters and preserves dollar replacement text', () => {
  assert.deepEqual(replaceTags({ title: 'A.B + A.B' }, { find: 'A.B', replace: '$&' }), { title: '$& + $&' });
});

test('regex replacement supports capture substitutions and all matching instances', () => {
  assert.deepEqual(replaceTags({ title: 'Song 01, Song 02', artist: 'Other' }, {
    find: 'Song (\\d+)', replace: 'Track $1', regex: true
  }), { title: 'Track 01, Track 02' });
  assert.throws(() => replaceTags({ title: 'x' }, { find: '[', regex: true }), /Invalid replacement regex/);
  assert.throws(() => replaceTags({ title: 'x' }, { find: '' }), /must not be empty/);
});

test('replacement preserves array-valued tags and skips missing or non-text fields', () => {
  const artists = Object.freeze(['Alpha', 'Beta', 42]);
  const tags = Object.freeze({ artist: artists, track: 1 });
  assert.deepEqual(replaceTags(tags, { find: 'a', replace: 'X', fields: ['artist', 'track', 'missing'] }), { artist: ['XlphX', 'BetX', 42] });
  assert.deepEqual(artists, ['Alpha', 'Beta', 42]);
});

test('clearTags returns an independent explicit patch and validates field names', () => {
  const fields = Object.freeze(['title', 'artist', 'lyrics', 'title']);
  assert.deepEqual(clearTags(fields), { title: '', artist: '', lyrics: '' });
  assert.deepEqual(clearTags([]), {});
  assert.throws(() => clearTags('title'), /fields must be an array/);
  assert.throws(() => clearTags(['__proto__']), /safe field names/);
});

test('portable module performs conversion without package resolution or network access', () => {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const module = { exports: {} };
  const sandbox = {
    module, exports: module.exports,
    require() { throw new Error('Unexpected runtime dependency'); },
    fetch() { throw new Error('Unexpected network access'); }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../source/core/text-tools.cjs'), 'utf8'), sandbox);
  assert.equal(module.exports.convertChinese('头发与音乐'), '頭髮與音樂');
});

test('Chinese conversion uses phrase dictionaries to disambiguate traditional characters', () => {
  assert.equal(convertChinese('音乐与头发，后台开发'), '音樂與頭髮，後臺開發');
  assert.equal(convertChinese('皇后在后台发现头发'), '皇后在後臺發現頭髮');
  assert.equal(convertChinese('乾坤與乾燥，頭髮與發展', { from: 't', to: 'cn' }), '乾坤与干燥，头发与发展');
});

test('Chinese conversion supports regional variants and reverse conversion', () => {
  assert.equal(convertChinese('鼠标和软件', { from: 'cn', to: 'twp' }), '滑鼠和軟體');
  assert.equal(convertChinese('滑鼠和軟體', { from: 'twp', to: 'cn' }), '鼠标和软件');
  assert.equal(convertChinese('裏面', { from: 'hk', to: 'tw' }), '裡面');
  assert.equal(convertChinese('漢字', { from: 't', to: 'jp' }), '漢字');
  assert.equal(convertChinese('English / 日本語 / 한글 🎵\n[00:01.200]音乐'), 'English / 日本語 / 한글 🎵\n[00:01.200]音樂');
  assert.equal(convertChinese('汉字', { from: 'cn', to: 'cn' }), '汉字');
  assert.equal(convertChinese(''), '');
  assert.throws(() => convertChinese('汉字', { to: 'auto' }), /locales/);
  assert.throws(() => convertChinese('', { from: 'invalid' }), /locales/);
  assert.throws(() => convertChinese(42), /must be a string/);
});

test('Chinese tag conversion returns immutable changed-only patches and supports field selection', () => {
  const artists = Object.freeze(['音乐家', 'Singer', 42]);
  const tags = Object.freeze({ title: '头发', artist: artists, album: 'Album', year: 2024 });
  assert.deepEqual(convertTags(tags), { title: '頭髮', artist: ['音樂家', 'Singer', 42] });
  assert.deepEqual(convertTags(tags, { fields: ['title', 'title', 'missing'] }), { title: '頭髮' });
  assert.equal(tags.artist, artists);
  assert.deepEqual(artists, ['音乐家', 'Singer', 42]);
  assert.deepEqual(convertTags({ title: 'English' }), {});
  assert.throws(() => convertTags(null), /tags must be an object/);
  assert.throws(() => convertTags({}, { fields: ['__proto__'] }), /safe field/);
  assert.throws(() => convertTags({}, { from: 'invalid' }), /locales/);
});

test('lyric layouts align exact timestamps rather than line positions', () => {
  const original = '[ar:Singer]\n[00:02]World\n[00:01]Hello';
  const translated = '[ar:Translator]\n[00:01]你好\n[00:03]额外';
  assert.equal(layoutLyrics(original, translated), '[ar:Singer]\n[00:01.000]Hello\n[00:01.000]你好\n[00:02.000]World\n[00:03.000]额外');
  assert.equal(layoutLyrics(original, translated, { layout: 'inline', separator: ' | ' }), '[ar:Singer]\n[00:01.000]Hello | 你好\n[00:02.000]World\n[00:03.000]额外');
});

test('lyric layout bakes independent offsets once and expands repeated timestamps', () => {
  const original = '[offset:100]\n[00:01][00:02]Hello';
  const translated = '[offset:200]\n[00:01][00:02]你好';
  assert.equal(layoutLyrics(original, translated, { layout: 'inline', offsetMs: 50, translationOffsetMs: -100 }), '[00:01.150]Hello / 你好\n[00:02.150]Hello / 你好');
  assert.equal(layoutLyrics('[01:00:00]Hello', '[60:00]你好', { layout: 'inline' }), '[60:00.000]Hello / 你好');
});

test('lyric layout preserves duplicate lines and timestamps without cross multiplication', () => {
  assert.equal(layoutLyrics('[00:01]Hello\n[00:01]Again', '[00:01]你好'), '[00:01.000]Hello\n[00:01.000]Again\n[00:01.000]你好');
  assert.equal(layoutLyrics('[00:01]Hi', '[00:01]Hi'), '[00:01.000]Hi\n[00:01.000]Hi');
  assert.equal(layoutLyrics('[Chorus]\n[00:01]Hi', '[00:01]你好'), '[Chorus]\n[00:01.000]Hi\n[00:01.000]你好');
});

test('plain lyric layouts retain blank lines and unmatched translations', () => {
  assert.equal(layoutLyrics('Hello\nWorld', '你好\n世界', { layout: 'inline' }), 'Hello / 你好\nWorld / 世界');
  assert.equal(layoutLyrics('Hello\nWorld', '你好\n世界\n额外'), 'Hello\n你好\nWorld\n世界\n额外');
  assert.equal(layoutLyrics('Hello\n\nWorld', '你好\n\n世界', { layout: 'inline' }), 'Hello / 你好\n\nWorld / 世界');
  assert.equal(layoutLyrics('[ar:Singer]\r\nHello', '[ar:Translator]\r\n你好', { layout: 'inline' }), '[ar:Singer]\nHello / 你好');
});

test('lyric layouts support single-language output, empty fallback, and safe validation', () => {
  assert.equal(layoutLyrics('[00:01]Hello', '[00:01]你好', { layout: 'original' }), '[00:01]Hello');
  assert.equal(layoutLyrics('[00:01]Hello', '[00:01]你好', { layout: 'translation' }), '[00:01]你好');
  assert.equal(layoutLyrics('[00:01]Hello', ''), '[00:01]Hello');
  assert.equal(layoutLyrics('', '[00:01]你好'), '[00:01]你好');
  assert.throws(() => layoutLyrics('[00:01]Hello', '你好'), /timed and untimed/);
  assert.throws(() => layoutLyrics('Hello', '你好', { layout: 'unknown' }), /Unknown lyric layout/);
  assert.throws(() => layoutLyrics('Hello', '你好', { separator: '\n' }), /single-line/);
  assert.throws(() => layoutLyrics('Hello', '你好', { translationOffsetMs: NaN }), /finite numbers/);
  assert.throws(() => layoutLyrics(42, '你好'), /must be strings/);
});

test('cleanLyrics integrates translation layout before timestamp and metadata cleanup', () => {
  assert.equal(cleanLyrics('[ar:Singer]\n[00:01]Hello', {
    translatedLyrics: '[00:01]你好', layout: 'inline', stripMetadata: true, removeBlank: true
  }), '[00:01.000]Hello / 你好');
  assert.equal(cleanLyrics('[00:01]Hello', { translatedLyrics: '[00:01]你好', stripTimes: true }), 'Hello\n你好');
  assert.equal(cleanLyrics('[offset:100]\n[00:01]Hello', {
    translatedLyrics: '[00:01.100]你好', layout: 'inline', offsetMs: 100
  }), '[00:01.200]Hello / 你好');
});
