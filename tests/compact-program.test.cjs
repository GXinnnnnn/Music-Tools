'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { safecompact, helperPath, pythonPath } = require('../scripts/compact-program.cjs');
const available = process.platform === 'win32' && fs.existsSync(pythonPath);
const program = 'resources/app/source/fixture.bin';
function temporary(t, files = [program]) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'music-tools-compact-'));
  // This resolved, uniquely-created directory is the only cleanup target.
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('music-tools-compact-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  for (const name of [program, 'data/user.txt', 'unknown-user-file.bin']) {
    const filename = path.join(root, ...name.split('/'));
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, Buffer.alloc(2 * 1024 * 1024, 65));
  }
  saveInventory(root, files);
  return root;
}
function saveInventory(root, files) {
  fs.writeFileSync(path.join(root, '.music-tools-generated.json'), JSON.stringify({ format: 1, files }));
}
function digest(filename) { return crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex'); }
function python(code, root) {
  const prelude = `import importlib.util,json,pathlib,sys\nspec=importlib.util.spec_from_file_location('compact_program',${JSON.stringify(helperPath)})\nm=importlib.util.module_from_spec(spec)\nspec.loader.exec_module(m)\nroot=pathlib.Path(${JSON.stringify(root)})\n`;
  const result = spawnSync(pythonPath, ['-I', '-B', '-c', prelude + code], { encoding: 'utf8', windowsHide: true });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}
function sizes(root, names) {
  return python(`w=m.Windows()\nprint(json.dumps({n:w.physical(root/n) for n in ${JSON.stringify(names)}}))\n`, root);
}
const win = { skip: !available && 'Requires the project embedded Python on Windows' };

test('manual wrapper requires explicit root and XPRESS8K', () => {
  assert.throws(() => safecompact(''), /explicit portable root/);
  assert.throws(() => safecompact('C:\\unused', { algorithm: 'LZX' }), /Only XPRESS8K/);
  assert.throws(() => safecompact('C:\\unused', { undo: 'yes' }), /booleans/);
});

test('all unsafe inventory entries reject atomically before any compact process', win, t => {
  const root = temporary(t);
  const bad = ['../outside.bin', '/absolute.bin', 'C:/outside.bin', 'C:outside.bin', '\\\\server\\share\\file',
    'resources\\app\\bad.bin', 'data/user.txt', 'DATA/user.txt', 'resources/app/data/file.bin',
    'music/song.flac', 'usermusic/song.mp3', '音乐/song.wav', 'bad:stream', 'bad*', 'bad?', 'bad\u0000',
    'resources//file', './file', 'bad./file', 'bad /file', 'NUL.txt', 'COM1/file', 'foo/../bar',
    '.music-tools-generated.json', 4, null, {}, program.toUpperCase()];
  const before = digest(path.join(root, ...program.split('/')));
  const result = python(`calls=[]\ndef forbidden(*a,**k):\n calls.append(a)\n raise AssertionError('compact ran before policy validation')\nm.subprocess.run=forbidden\nrejected=[]\nfor bad in ${JSON.stringify(bad).replace(/\bnull\b/g, 'None')}:\n (root/m.INVENTORY).write_text(json.dumps({'format':1,'files':[${JSON.stringify(program)},bad]}),encoding='utf-8')\n try:\n  m.compact_program(root)\n except m.PolicyError:\n  rejected.append(True)\n else:\n  rejected.append(False)\nprint(json.dumps({'rejected':rejected,'calls':len(calls)}))\n`, root);
  assert.equal(result.rejected.length, bad.length);
  assert.ok(result.rejected.every(Boolean), JSON.stringify(result));
  assert.equal(result.calls, 0);
  assert.equal(digest(path.join(root, ...program.split('/'))), before);
});

test('malformed inventory objects, duplicate JSON keys, duplicates and directories reject', win, t => {
  const root = temporary(t);
  const invalid = [JSON.stringify({ format: true, files: [program] }), '{"format":1,"format":1,"files":[]}',
    JSON.stringify({ format: 2, files: [] }), JSON.stringify({ format: 1, files: 'bad' }),
    JSON.stringify({ format: 1, files: [program, program] }), '{bad json',
    JSON.stringify({ format: 1, files: [program, 'resources/app/source'] })];
  for (const raw of invalid) {
    fs.writeFileSync(path.join(root, '.music-tools-generated.json'), raw);
    assert.throws(() => safecompact(root, { json: true }), /inventory|Inventory|Duplicate|regular file/);
  }
});

test('junctions, junction roots and hard links cannot authorize outside files', win, t => {
  const root = temporary(t);
  const outside = temporary(t);
  const source = path.join(outside, ...program.split('/'));
  const before = digest(source);
  const junction = path.join(root, 'linked');
  fs.symlinkSync(outside, junction, 'junction');
  saveInventory(root, [program, 'linked/' + program]);
  assert.throws(() => safecompact(root, { json: true }), /Links\/reparse/);
  assert.throws(() => safecompact(junction, { json: true }), /Links\/reparse/);
  fs.linkSync(source, path.join(root, 'hardlink.bin'));
  saveInventory(root, [program, 'hardlink.bin']);
  assert.throws(() => safecompact(root, { json: true }), /hard links/);
  assert.equal(digest(source), before);
});

test('unsupported filesystem is a clear harmless skip with the inventory unchanged', win, t => {
  const root = temporary(t);
  const inventory = fs.readFileSync(path.join(root, '.music-tools-generated.json'));
  const result = python(`original=m.Windows\nclass Unsupported(original):\n def filesystem(self,root): return 'exFAT'\n def compact(self): raise AssertionError('must not locate or run compact')\nm.Windows=Unsupported\nprint(json.dumps(m.compact_program(root)))\n`, root);
  assert.equal(result.status, 'skipped');
  assert.equal(result.processed, 0);
  assert.equal(result.skipped, 1);
  assert.match(result.reason, /NTFS.*exFAT/);
  assert.deepEqual(fs.readFileSync(path.join(root, '.music-tools-generated.json')), inventory);
});

test('missing files and command access failures produce explicit best-effort counts', win, t => {
  const root = temporary(t, [program, 'missing.bin']);
  const result = python(`def denied(*a,**k): raise PermissionError('synthetic access denied')\nm.subprocess.run=denied\nprint(json.dumps(m.compact_program(root)))\n`, root);
  if (result.status === 'skipped') return t.skip(result.reason);
  assert.equal(result.status, 'partial');
  assert.equal(result.total, 2);
  assert.equal(result.skipped, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.processed, 0);
  assert.ok(result.errors.some(item => /synthetic access denied/.test(item.error)));
});

test('failed batches retry individual files and report only actual failures', win, t => {
  const root = temporary(t);
  const second = 'resources/app/source/second.bin';
  fs.copyFileSync(path.join(root, ...program.split('/')), path.join(root, ...second.split('/')));
  saveInventory(root, [program, second]);
  const result = python(`calls=[]\ndef partial(args,**kwargs):\n calls.append(args)\n code=1 if len(calls)==1 or args[-1].endswith('second.bin') else 0\n return m.subprocess.CompletedProcess(args,code,'','synthetic locked file' if code else '')\nm.subprocess.run=partial\nresult=m.compact_program(root)\nprint(json.dumps({'result':result,'calls':len(calls)}))\n`, root);
  if (result.result.status === 'skipped') return t.skip(result.result.reason);
  assert.equal(result.calls, 3);
  assert.equal(result.result.processed, 1);
  assert.equal(result.result.failed, 1);
  assert.deepEqual(result.result.errors[0].files, [second]);
});

test('ownership inventory is held against writes throughout a Windows operation', win, t => {
  const root = temporary(t);
  const before = fs.readFileSync(path.join(root, '.music-tools-generated.json'));
  const result = python(`blocked=False\nwith m.Windows().lock(root/m.INVENTORY,inventory=True):\n try:\n  (root/m.INVENTORY).write_bytes(b'{}')\n except PermissionError:\n  blocked=True\nprint(json.dumps({'blocked':blocked}))\n`, root);
  assert.equal(result.blocked, true);
  assert.deepEqual(fs.readFileSync(path.join(root, '.music-tools-generated.json')), before);
});

test('large Unicode argument lists stay within the UTF-16 command budget', win, t => {
  const root = temporary(t);
  const result = python(`entries=[(str(i),root/('音乐工具'+str(i)+'x'*180+'.bin')) for i in range(1200)]\nbase=['C:/Windows/System32/compact.exe','/C','/EXE:XPRESS8K','/Q']\nbatches=list(m._batches(base,entries))\nprint(json.dumps({'counts':[len(b) for b in batches],'units':[m._units(base+[str(p) for _,p in b]) for b in batches]}))\n`, root);
  assert.equal(result.counts.reduce((a, b) => a + b), 1200);
  assert.ok(result.counts.every(n => n <= 64));
  assert.ok(result.units.every(n => n <= 28000));
  assert.ok(result.counts.length > 1);
});

test('actual NTFS compress/undo preserves every byte and never selects data or unknown files', win, t => {
  const root = temporary(t);
  const names = [program, 'data/user.txt', 'unknown-user-file.bin', '.music-tools-generated.json'];
  const hashes = names.map(name => digest(path.join(root, ...name.split('/'))));
  const before = sizes(root, names);
  const compressed = safecompact(root, { json: true });
  if (compressed.status === 'skipped') return t.skip(compressed.reason);
  assert.equal(compressed.status, 'ok', JSON.stringify(compressed));
  assert.equal(compressed.processed, 1);
  assert.equal(compressed.logicalBytesBefore, 2 * 1024 * 1024);
  assert.equal(compressed.logicalBytesAfter, compressed.logicalBytesBefore);
  const after = sizes(root, names);
  assert.ok(after[program] < before[program], JSON.stringify({ before, after, compressed }));
  assert.equal(after[program], compressed.physicalBytesAfter);
  for (const name of names.slice(1)) assert.equal(after[name], before[name], name);
  assert.deepEqual(names.map(name => digest(path.join(root, ...name.split('/')))), hashes);
  const restored = safecompact(root, { undo: true, json: true });
  assert.equal(restored.status, 'ok', JSON.stringify(restored));
  assert.equal(restored.processed, 1);
  assert.equal(restored.logicalBytesBefore, restored.logicalBytesAfter);
  assert.ok(sizes(root, [program])[program] > after[program]);
  assert.deepEqual(names.map(name => digest(path.join(root, ...name.split('/')))), hashes);
});

test('packaged helper default root points to portable root', win, t => {
  const root = temporary(t, []);
  const copiedHelper = path.join(root, 'resources', 'app', 'source', 'core', 'compact_program.py');
  fs.mkdirSync(path.dirname(copiedHelper), { recursive: true });
  fs.copyFileSync(helperPath, copiedHelper);
  const run = spawnSync(pythonPath, ['-I', '-B', copiedHelper, '--json'], { encoding: 'utf8', windowsHide: true });
  assert.ifError(run.error);
  assert.equal(run.status, 0, run.stderr || run.stdout);
  assert.equal(JSON.parse(run.stdout).root.toLowerCase(), root.toLowerCase());
});
