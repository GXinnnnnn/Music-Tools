'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const audio = require('../source/core/audio.cjs');

const python = process.env.MUSIC_TOOLS_TEST_PYTHON || path.resolve(__dirname, '../source/vendor/python/python.exe');
const fixtureScript = path.resolve(__dirname, '../scripts/engine-fixtures.py');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'music-tools-core-'));
const originals = path.join(root, 'fixtures');
const dataDir = path.join(root, 'app-data');
const cover = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const tags = {title: '新标题 ✓', artist: '测试歌手', album: '便携专辑', albumArtist: '专辑艺术家', year: '2026',
  track: '3/12', disc: '1/2', genre: 'Acoustic', composer: '作曲者', lyricist: '作词者', comment: '保留未知标签', lyrics: '[00:01.00]歌词第一行\n[00:02.50]第二行'};
let fixtures;
function pythonTool(command, target) {
  return JSON.parse(execFileSync(python, ['-X', 'utf8', fixtureScript, command, target], { encoding: 'utf8', windowsHide: true }));
}
function clone(extension, label) {
  const source = fixtures.find(file => file.endsWith('.' + extension));
  const folder = path.join(root, label);
  fs.mkdirSync(folder, { recursive: true });
  const destination = path.join(folder, path.basename(source));
  fs.copyFileSync(source, destination);
  return destination;
}
function sha(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }

test.before(() => {
  fixtures = pythonTool('build', originals);
  audio.setPythonPath(python);
  audio.setDataDir(dataDir);
});
test.after(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

test('real audio formats: tag/cover roundtrip preserves unknown metadata and decoded audio, full backup restores original bytes', async t => {
  for (const extension of ['wav', 'mp3', 'flac', 'm4a', 'ogg', 'opus', 'aiff', 'wma', 'wv', 'dsf']) {
    await t.test(extension.toUpperCase(), async () => {
      const file = clone(extension, 'roundtrip-' + extension);
      const originalHash = sha(file);
      const pcm = extension === 'dsf' ? null : pythonTool('pcmHash', file);
      const before = await audio.read(file);
      assert.ok(before.duration > 0);
      assert.ok(before.sampleRate > 0);
      assert.equal(before.stamp.sha256, originalHash);
      const result = await audio.writeBatch([{ path: file, tags, cover, stamp: before.stamp }]);
      assert.deepEqual(result.errors, []);
      assert.equal(result.results.length, 1);
      const saved = await audio.read(file);
      for (const [key, value] of Object.entries(tags)) assert.equal(saved.tags[key], value, `${extension}: ${key}`);
      assert.equal(saved.cover, cover);
      assert.equal(saved.duration, before.duration);
      const custom = pythonTool('inspect', file);
      assert.equal(custom.unknown, 'preserve-me-原始');
      if (custom.otherComment !== null) assert.equal(custom.otherComment, 'French comment');
      if (pcm) assert.equal(pythonTool('pcmHash', file), pcm, 'audio payload decodes identically');
      const history = await audio.history();
      const backup = history.find(entry => entry.id === result.results[0].backupId);
      assert.equal(backup.status, 'complete');
      assert.equal(sha(backup.backupPath), originalHash);
      const restored = await audio.restore(backup.id);
      assert.equal(restored.record.path, file);
      assert.equal(sha(file), originalHash, 'restore is byte exact');
      assert.ok((await audio.history()).find(entry => entry.id === backup.id).restoredAt);
    });
  }
});

test('recursive scan deduplicates input and reports corrupt files without losing valid records', async () => {
  const file = clone('flac', 'scan');
  const nested = path.join(path.dirname(file), 'nested');
  fs.mkdirSync(nested);
  const nestedFile = path.join(nested, 'nested.wav');
  fs.copyFileSync(fixtures.find(item => item.endsWith('.wav')), nestedFile);
  fs.writeFileSync(path.join(nested, 'bad.mp3'), 'not an MP3');
  fs.writeFileSync(path.join(nested, 'notes.txt'), 'ignored');
  const result = await audio.scan([path.dirname(file), file, nested]);
  assert.equal(result.files.length, 2);
  assert.equal(new Set(result.files.map(record => record.path)).size, 2);
  assert.equal(result.errors.length, 1);
  assert.ok(result.errors[0].path.endsWith('bad.mp3'));
});

test('batch reports each error and stages invalid writes without altering original files', async () => {
  const valid = clone('wav', 'partial-valid');
  const invalid = clone('m4a', 'partial-invalid');
  const hash = sha(invalid);
  const result = await audio.writeBatch([
    {path: valid, tags: {title: '有效修改'}},
    {path: invalid, tags: {track: 'abc'}},
    {path: path.join(root, 'missing.mp3'), tags: {title: '不存在'}},
  ]);
  assert.equal(result.results.length, 1);
  assert.equal(result.errors.length, 2);
  assert.equal(result.errors[0].code, 'INVALID_NUMBER');
  assert.equal(sha(invalid), hash);
  assert.equal((await audio.read(valid)).tags.title, '有效修改');
  const badCover = await audio.writeBatch([{path: invalid, tags: {title: '不会应用'}, cover: 'invalid'}]);
  assert.equal(badCover.errors[0].code, 'INVALID_COVER');
  assert.equal(sha(invalid), hash);
});

test('cached read stamps reject external modifications when caller omits explicit stamp', async () => {
  const file = clone('wav', 'write-conflict');
  await audio.read(file);
  fs.appendFileSync(file, Buffer.from('external change'));
  const changedHash = sha(file);
  const result = await audio.writeBatch([{path: file, tags: {title: '不能覆盖'}}]);
  assert.equal(result.errors[0].code, 'EXTERNAL_MODIFICATION');
  assert.equal(sha(file), changedHash);
});

test('restore refuses to overwrite a file changed outside the application', async () => {
  const file = clone('flac', 'restore-conflict');
  const result = await audio.writeBatch([{path: file, tags: {title: '可恢复'}}]);
  assert.deepEqual(result.errors, []);
  fs.appendFileSync(file, Buffer.from('external change'));
  const changedHash = sha(file);
  await assert.rejects(audio.restore(result.results[0].backupId), error => error.code === 'EXTERNAL_MODIFICATION');
  assert.equal(sha(file), changedHash);
});

test('rename preview sanitizes names, apply preserves bytes, and history restores old name', async () => {
  const file = clone('wav', 'rename');
  await audio.writeBatch([{path: file, tags: {artist: '歌手:名称', title: '歌曲/标题', track: '3/12'}}]);
  const before = sha(file);
  const pattern = '{track:02} - {artist} - {title}';
  const preview = await audio.renamePreview([{path: file}], pattern);
  assert.deepEqual(preview.errors, []);
  assert.equal(preview.results[0].filename, '03 - 歌手_名称 - 歌曲_标题.wav');
  assert.ok(fs.existsSync(file), 'preview has no side effects');
  const result = await audio.renameBatch([{path: file}], pattern);
  assert.deepEqual(result.errors, []);
  const target = result.results[0].newPath;
  assert.equal(fs.existsSync(file), false);
  assert.equal(sha(target), before);
  await audio.restore(result.results[0].backupId);
  assert.ok(fs.existsSync(file));
  assert.equal(fs.existsSync(target), false);
  assert.equal(sha(file), before);
  const collision = path.join(path.dirname(file), 'occupied.wav');
  fs.copyFileSync(file, collision);
  const rejected = await audio.renameBatch([{path: file}], 'occupied');
  assert.equal(rejected.errors[0].code, 'NAME_COLLISION');
  assert.equal(sha(file), before);
});

test('sidecar export creates UTF-8 LRC and binary cover without overwriting existing sidecars', async () => {
  const file = clone('flac', 'sidecars');
  const written = await audio.writeBatch([{path: file, tags: {lyrics: tags.lyrics}, cover}]);
  assert.deepEqual(written.errors, []);
  const directory = path.join(root, 'exports');
  const exported = await audio.exportSidecars([{path: file}], {directory});
  assert.deepEqual(exported.errors, []);
  assert.equal(exported.results[0].files.length, 2);
  const lrc = exported.results[0].files.find(item => item.endsWith('.lrc'));
  const png = exported.results[0].files.find(item => item.endsWith('.png'));
  assert.equal(fs.readFileSync(lrc, 'utf8'), tags.lyrics);
  assert.deepEqual(fs.readFileSync(png), Buffer.from(cover.split(',')[1], 'base64'));
  const again = await audio.exportSidecars([{path: file}], {directory});
  assert.equal(again.errors.length, 1);
  assert.equal(fs.readFileSync(lrc, 'utf8'), tags.lyrics);
});

test('corrupted backup fails verification and leaves the current audio untouched', async () => {
  const file = clone('wav', 'bad-backup');
  const result = await audio.writeBatch([{path: file, tags: {title: '保持当前'}}]);
  const id = result.results[0].backupId;
  const entry = (await audio.history()).find(item => item.id === id);
  fs.appendFileSync(entry.backupPath, 'corrupt');
  const hash = sha(file);
  await assert.rejects(audio.restore(id), error => error.code === 'CORRUPT_BACKUP');
  assert.equal(sha(file), hash);
});

test('interruption after replacement remains safely recoverable from pending indexed backup', async () => {
  const file = clone('flac', 'pending-backup');
  const original = sha(file);
  const result = await audio.writeBatch([{path: file, tags: {title: '模拟中断'}}]);
  assert.deepEqual(result.errors, []);
  const id = result.results[0].backupId;
  const index = path.join(dataDir, 'backups', 'index.json');
  const entries = JSON.parse(fs.readFileSync(index, 'utf8'));
  entries.find(entry => entry.id === id).status = 'pending';
  fs.writeFileSync(index, JSON.stringify(entries));
  await audio.restore(id);
  assert.equal(sha(file), original);
});

test('unreadable backup index stops writes before modifying audio', async () => {
  const file = clone('wav', 'corrupt-index');
  const original = sha(file);
  const index = path.join(dataDir, 'backups', 'index.json');
  const previous = fs.readFileSync(index);
  try {
    fs.writeFileSync(index, '{invalid json');
    const result = await audio.writeBatch([{path: file, tags: {title: '不能提交'}}]);
    assert.equal(result.errors[0].code, 'CORRUPT_HISTORY');
    assert.equal(sha(file), original);
  } finally {
    fs.writeFileSync(index, previous);
  }
});

test('rename treats braces and percent strings inside tag text as literal filename data', async () => {
  const file = clone('flac', 'literal-pattern-text');
  const result = await audio.writeBatch([{path: file, tags: {title: '歌曲 {现场} %artist%', artist: '歌手'}}]);
  assert.deepEqual(result.errors, []);
  const preview = await audio.renamePreview([{path: file}], '%artist% - {title}');
  assert.deepEqual(preview.errors, []);
  assert.equal(preview.results[0].filename, '歌手 - 歌曲 {现场} %artist%.flac');
});

test('cover clear preserves other fields and percent template aliases work', async () => {
  const file = clone('mp3', 'clear-cover');
  await audio.writeBatch([{path: file, tags: {title: '标题', artist: '歌手'}, cover}]);
  const cleared = await audio.writeBatch([{path: file, cover: ''}]);
  assert.deepEqual(cleared.errors, []);
  const read = await audio.read(file);
  assert.equal(read.cover, '');
  assert.equal(read.tags.title, '标题');
  const preview = await audio.renamePreview([{path: file}], '%artist% - %title%');
  assert.deepEqual(preview.errors, []);
  assert.equal(preview.results[0].filename, '歌手 - 标题.mp3');
});
