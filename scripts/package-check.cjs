'use strict';
// Verify inventory-driven stale cleanup and preservation using only disposable sentinels.
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { buildPortable, generatedPath } = require('./package.cjs');
const root = path.resolve(__dirname, '..');
const portable = path.join(root, 'release', 'Music Tools');
(async () => {
  const id = 'packaging-preservation-' + Date.now();
  const sentinels = [path.join(portable, 'data', id + '.json'), path.join(portable, id + '.wav'), path.join(portable, 'resources', id + '.flac')];
  const staleRelative = 'resources/app/source/' + id + '-stale.cjs';
  const stale = generatedPath(staleRelative);
  const inventoryPath = path.join(portable, '.music-tools-generated.json');
  const original = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  for (const file of sentinels) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, id); }
  fs.writeFileSync(stale, '// disposable stale generated file');
  fs.writeFileSync(inventoryPath, JSON.stringify({ ...original, files: [...original.files, staleRelative] }, null, 2));
  try {
    for (const unsafe of ['../audio.wav', 'data/audio.wav', 'DATA/state.json', 'resources/../../audio.wav', 'C:/audio.wav', 'resources\\file']) assert.throws(() => generatedPath(unsafe), /Unsafe/);
    const result = await buildPortable();
    assert.equal(fs.existsSync(stale), false);
    assert.ok(result.removedGeneratedFiles.includes(staleRelative));
    for (const file of sentinels) assert.equal(fs.readFileSync(file, 'utf8'), id);
    assert.equal(fs.existsSync(path.join(portable, 'resources', 'installed-mode')), false);
    assert.equal(fs.existsSync(path.join(portable, 'resources', 'default_app.asar')), false);
    assert.deepEqual(fs.readdirSync(path.join(portable, 'locales')).sort(), ['en-US.pak', 'zh-CN.pak']);
    const report = { passed: true, staleGeneratedFileRemoved: true, portableDataPreserved: true, addedAudioPreserved: true, unsafePathsRejected: true, onlyRequiredLocales: true, portableHasNoInstallMarker: true, checkedAt: new Date().toISOString() };
    fs.writeFileSync(path.join(root, 'artifacts', 'package-check.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    // Only remove the exact disposable files created above; no directory tree cleanup.
    for (const file of [...sentinels, stale]) {
      const relative = path.relative(portable, file);
      assert.ok(relative && !relative.startsWith('..') && path.basename(file).startsWith(id));
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
