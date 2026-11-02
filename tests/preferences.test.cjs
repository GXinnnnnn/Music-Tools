'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createPreferences } = require('../source/core/preferences.cjs');

async function profile(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'music-tools-preferences-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  return directory;
}

test('backup defaults on, returns isolated values, and does not create a settings file merely by reading', async t => {
  const directory = await profile(t), preferences = createPreferences(directory);
  const first = await preferences.get();
  assert.deepEqual(first, { backupEnabled: true });
  first.backupEnabled = false;
  assert.deepEqual(await preferences.get(), { backupEnabled: true });
  assert.deepEqual(await fs.readdir(directory), []);
});

test('backup setting is saved as JSON, survives a fresh store, and can be enabled again', async t => {
  const directory = path.join(await profile(t), 'nested', 'profile');
  const preferences = createPreferences(directory);
  const saved = await preferences.set({ backupEnabled: false, untrustedExtra: 'discard' });
  assert.deepEqual(saved, { backupEnabled: false });
  saved.backupEnabled = true;
  assert.deepEqual(await preferences.get(), { backupEnabled: false });
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, 'preferences.json'), 'utf8')), { backupEnabled: false });
  assert.deepEqual(await createPreferences(directory).get(), { backupEnabled: false });
  assert.deepEqual(await fs.readdir(directory), ['preferences.json'], 'atomic save must leave no temporary file');
  await preferences.set({ backupEnabled: true });
  assert.deepEqual(await createPreferences(directory).get(), { backupEnabled: true });
});

test('invalid preference writes reject without altering saved state or poisoning later saves', async t => {
  const directory = await profile(t), preferences = createPreferences(directory);
  await preferences.set({ backupEnabled: false });
  const before = await fs.readFile(path.join(directory, 'preferences.json'), 'utf8');
  for (const patch of [undefined, null, true, false, '', {}, { backupEnabled: 0 }, { backupEnabled: 1 }, { backupEnabled: 'false' }, { backupEnabled: null }]) {
    await assert.rejects(preferences.set(patch), TypeError);
    assert.deepEqual(await preferences.get(), { backupEnabled: false });
    assert.equal(await fs.readFile(path.join(directory, 'preferences.json'), 'utf8'), before);
  }
  await preferences.set({ backupEnabled: true });
  assert.deepEqual(await createPreferences(directory).get(), { backupEnabled: true });
});

test('corrupt JSON and invalid saved values recover to backup on and can be overwritten', async t => {
  const directory = await profile(t), filename = path.join(directory, 'preferences.json');
  for (const text of ['{broken', '', 'null', '[]', '{}', '{"backupEnabled":"false"}', '{"backupEnabled":0}']) {
    await fs.writeFile(filename, text, 'utf8');
    const preferences = createPreferences(directory);
    assert.deepEqual(await preferences.get(), { backupEnabled: true }, text);
    await preferences.set({ backupEnabled: false });
    assert.deepEqual(await createPreferences(directory).get(), { backupEnabled: false });
    assert.deepEqual(JSON.parse(await fs.readFile(filename, 'utf8')), { backupEnabled: false });
  }
});

test('concurrent saves preserve call order, expose complete JSON, and the final value survives reload', async t => {
  const directory = await profile(t), preferences = createPreferences(directory);
  const values = Array.from({ length: 25 }, (_, index) => index % 2 === 0);
  values.push(false);
  const saves = values.map(backupEnabled => preferences.set({ backupEnabled }));
  const current = preferences.get();
  const results = await Promise.all(saves);
  assert.deepEqual(results, values.map(backupEnabled => ({ backupEnabled })));
  assert.deepEqual(await current, { backupEnabled: false });
  assert.deepEqual(await createPreferences(directory).get(), { backupEnabled: false });
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(directory, 'preferences.json'), 'utf8')), { backupEnabled: false });
  assert.deepEqual(await fs.readdir(directory), ['preferences.json']);
});

test('a failed atomic rename preserves memory and recovers after the filesystem obstacle is removed', async t => {
  const directory = await profile(t), preferences = createPreferences(directory), filename = path.join(directory, 'preferences.json');
  await preferences.get();
  await fs.mkdir(filename);
  await assert.rejects(preferences.set({ backupEnabled: false }));
  assert.deepEqual(await preferences.get(), { backupEnabled: true });
  assert.deepEqual(await fs.readdir(directory), ['preferences.json'], 'failed save cleans its temporary file');
  await fs.rmdir(filename);
  await preferences.set({ backupEnabled: false });
  assert.deepEqual(await createPreferences(directory).get(), { backupEnabled: false });
});
