'use strict';
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const service = require('../source/core/lyric-service.cjs');
(async () => {
  const root = path.resolve(__dirname, '..'), directory = fs.mkdtempSync(path.join(root, 'artifacts/lyrics-live-'));
  const audioPath = path.join(directory, 'original-demo.wav');
  const demo = fs.readdirSync(path.join(root, 'source/demo')).find(name => name.endsWith('.wav'));
  fs.copyFileSync(path.join(root, 'source/demo', demo), audioPath);
  const hash = () => crypto.createHash('sha256').update(fs.readFileSync(audioPath)).digest('hex'), before = hash();
  const rows = [];
  for (const source of ['qq', 'netease']) {
    const found = await service.search('晴天 周杰伦', { sources: [source], timeoutMs: 15000, retries: 1 });
    assert.ok(found.candidates.length, source + ' candidates');
    let chosen, data;
    for (const candidate of found.candidates.slice(0, 3)) {
      const value = await service.fetchLyrics(candidate, { timeoutMs: 15000, retries: 1 });
      if (value.original && /\[\d+:\d+/.test(value.original)) { chosen = candidate; data = value; break; }
    }
    assert.ok(chosen, source + ' timed lyric');
    const options = { format: 'srt', layout: 'bilingual', duration: chosen.duration, filenameTemplate: '{source} - {title} - {artist}' };
    const preview = service.preview(data, options); assert.ok(preview.cues.length > 5); assert.match(preview.text, /\d\d:\d\d:\d\d,\d{3} -->/);
    const saved = await service.exportLyrics({ audioPath, directory, ...data, metadata: chosen, options });
    assert.equal(fs.readFileSync(saved.path, 'utf8'), preview.text);
    rows.push({ source, candidate: chosen, originalCharacters: data.original.length, translatedCharacters: data.translated.length,
      cues: preview.cues.length, output: saved.path, warnings: preview.warnings, providerErrors: [...found.errors, ...data.errors],
      identityNote: '接口及时间轴验证；此处人工选择候选，不表示与其他平台的同名录音为同一版本' });
  }
  assert.equal(hash(), before);
  const result = { passed: true, timestamp: new Date().toISOString(), audioUnchanged: true, rows };
  fs.writeFileSync(path.join(root, 'artifacts/lyrics-live-check.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
