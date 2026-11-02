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
const core = path.resolve(__dirname, '../source/core');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'music-tools-audio-policy-'));
const picture = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64').toString('base64');
let fixtures;

function py(code, ...args) {
  return JSON.parse(execFileSync(python, ['-X', 'utf8', '-c', `import sys,json\nsys.path.insert(0, ${JSON.stringify(core)})\nimport engine\nfrom pathlib import Path\n${code}`, ...args], { encoding: 'utf8', windowsHide: true }));
}
function tool(command, target) {
  return JSON.parse(execFileSync(python, ['-X', 'utf8', fixtureScript, command, target], { encoding: 'utf8', windowsHide: true }));
}
function context(label) {
  const directory = path.join(root, label);
  fs.mkdirSync(directory, { recursive: true });
  const data = path.join(directory, 'app-data');
  audio.setDataDir(data);
  return { directory, data };
}
function clone(directory, extension) {
  const destination = path.join(directory, '歌曲.' + extension);
  fs.copyFileSync(fixtures.find(file => file.endsWith('.' + extension)), destination);
  return destination;
}
function blank(directory, name = '空白.wav') {
  const file = path.join(directory, name);
  py("import wave\nwith wave.open(sys.argv[1], 'wb') as out:\n out.setnchannels(1); out.setsampwidth(2); out.setframerate(44100); out.writeframes(b'\\x00\\x00'*8820)\nprint(json.dumps(True))", file);
  return file;
}
function sha(file) { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
function noArtifacts(data, directory) {
  assert.equal(fs.existsSync(path.join(data, 'backups')), false, 'no backup file or index directory');
  assert.deepEqual(fs.readdirSync(directory).filter(name => /^\.(music-tools|backup)-/.test(name)), [], 'no staging files remain');
}
function inspect(file) {
  return py(`a=engine.load_audio(Path(sys.argv[1]))
t=a.tags
r={'keys':list(t.keys()) if t is not None else [], 'unknownFrames':len(getattr(t,'unknown_frames',[])), 'failedAtoms':bool(getattr(t,'_failed_atoms',{})), 'pictures':len(getattr(a,'pictures',[])), 'blocks':[b.code for b in getattr(a,'metadata_blocks',[])]}
if type(a).__name__=='WAVE':
 from mutagen._riff import RiffFile
 with open(sys.argv[1],'rb') as f: r['chunks']=[c.id for c in RiffFile(f).root.subchunks()]
print(json.dumps(r))`, file);
}
function seedPictures(file) {
  return py(`import base64
from mutagen.id3 import ID3,APIC
from mutagen.flac import FLAC,Picture
from mutagen.mp4 import MP4,MP4Cover
from mutagen.asf import ASF,ASFByteArrayAttribute
from mutagen.apev2 import APEv2,APEBinaryValue
import struct
a=engine.load_audio(Path(sys.argv[1])); t=a.tags; raw=base64.b64decode(sys.argv[2])
for kind in (3,4,8):
 if isinstance(t,ID3): t.add(APIC(encoding=3,mime='image/png',type=kind,desc='image-'+str(kind),data=raw))
 elif isinstance(a,FLAC):
  p=Picture(); p.type=kind; p.mime='image/png'; p.data=raw; a.add_picture(p)
 elif isinstance(a,MP4): t.setdefault('covr',[]).append(MP4Cover(raw,imageformat=MP4Cover.FORMAT_PNG))
 elif isinstance(a,ASF): t.setdefault('WM/Picture',[]).append(ASFByteArrayAttribute(struct.pack('<BI',kind,len(raw))+'image/png'.encode('utf-16-le')+b'\\0\\0\\0\\0'+raw))
 elif isinstance(t,APEv2): t['Cover Art ('+str(kind)+')']=APEBinaryValue(b'image.png\\0'+raw)
 else:
  p=Picture(); p.type=kind; p.mime='image/png'; p.data=raw; t.setdefault('metadata_block_picture',[]).append(base64.b64encode(p.write()).decode('ascii'))
a.save()
print(json.dumps(True))`, file, picture);
}

test.before(() => {
  fixtures = tool('build', path.join(root, 'fixtures'));
  audio.setPythonPath(python);
});
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('backup disabled applies to writes and third-argument rename options without backup artifacts', async () => {
  const { directory, data } = context('disabled');
  const file = clone(directory, 'mp3');
  const written = await audio.writeBatch([{ path: file, tags: { title: '新标题' } }], { backupEnabled: false });
  assert.deepEqual(written.errors, []);
  assert.equal(written.results[0].backupSkipped, 'disabled');
  assert.equal(written.results[0].backupId, undefined);
  assert.equal(written.results[0].record.tags.title, '新标题');
  const renamed = await audio.renameBatch([{ path: file }], '新文件名', { backupEnabled: false });
  assert.deepEqual(renamed.errors, []);
  assert.equal(renamed.results[0].backupSkipped, 'disabled');
  assert.equal(path.basename(renamed.results[0].newPath), '新文件名.mp3');
  assert.deepEqual(await audio.history(), []);
  noArtifacts(data, directory);
});

test('first write and rename of a genuinely blank file skip backups; later tagged edits default to backup', async () => {
  const { directory, data } = context('empty');
  const file = blank(directory);
  const before = await audio.read(file);
  assert.equal(before.hasMetadata, false);
  const renamed = await audio.renameBatch([{ path: file }], '空白重命名');
  assert.deepEqual(renamed.errors, []);
  assert.equal(renamed.results[0].backupSkipped, 'empty');
  const target = renamed.results[0].newPath;
  const first = await audio.writeBatch([{ path: target, tags: { title: '第一版' } }]);
  assert.deepEqual(first.errors, []);
  assert.equal(first.results[0].backupSkipped, 'empty');
  assert.equal(first.results[0].record.hasMetadata, true);
  noArtifacts(data, directory);
  const originalHash = sha(target);
  const second = await audio.writeBatch([{ path: target, tags: { title: '第二版' } }]);
  assert.deepEqual(second.errors, []);
  assert.ok(second.results[0].backupId);
  const history = await audio.history();
  assert.equal(history.length, 1);
  assert.equal(sha(history[0].backupPath), originalHash);
});

test('unknown-only native metadata still requires a default backup for write and rename', async () => {
  const { directory } = context('unknown-only');
  for (const extension of ['flac', 'm4a', 'wv']) {
    const file = clone(directory, extension);
    py(`a=engine.load_audio(Path(sys.argv[1])); t=a.tags
for key in list(t.keys()):
 if 'MusicTag' not in key and 'musictag' not in key: del t[key]
a.save()
print(json.dumps(True))`, file);
    const before = await audio.read(file);
    assert.ok(Object.values(before.tags).every(value => !value), extension);
    assert.equal(before.hasMetadata, true, extension);
    const changed = extension === 'wv'
      ? await audio.renameBatch([{ path: file }], '只含未知元数据')
      : await audio.writeBatch([{ path: file, tags: { title: '新增标题' } }]);
    assert.deepEqual(changed.errors, []);
    assert.ok(changed.results[0].backupId, extension);
  }
});

test('native clear removes unknown fields, all picture types and container metadata across real formats; audio and dates survive', async t => {
  for (const extension of ['wav', 'mp3', 'flac', 'm4a', 'ogg', 'opus', 'aiff', 'wma', 'wv', 'dsf']) {
    await t.test(extension, async () => {
      const { directory, data } = context('clear-' + extension);
      const file = clone(directory, extension);
      seedPictures(file);
      if (extension === 'flac') {
        py(`from mutagen.flac import MetadataBlock
a=engine.load_audio(Path(sys.argv[1])); block=MetadataBlock(b'app1private-data'); block.code=2; a.metadata_blocks.append(block); a.save()
print(json.dumps(True))`, file);
      }
      const old = new Date('2003-04-05T06:07:08.000Z');
      fs.utimesSync(file, old, old);
      const statBefore = fs.statSync(file, { bigint: true });
      const rawBefore = fs.readFileSync(file);
      const pcm = extension === 'dsf' ? null : tool('pcmHash', file);
      const result = await audio.clearBatch([{ path: file }], { backupEnabled: false });
      assert.deepEqual(result.errors, []);
      assert.equal(result.results[0].backupSkipped, 'disabled');
      assert.equal(result.results[0].record.hasMetadata, false);
      assert.equal(result.results[0].record.cover, '');
      assert.ok(Object.values(result.results[0].record.tags).every(value => value === ''));
      assert.equal(result.results[0].record.filename, path.basename(file));
      const raw = inspect(file);
      assert.deepEqual(raw.keys, []);
      assert.equal(raw.unknownFrames, 0);
      assert.equal(raw.failedAtoms, false);
      assert.equal(raw.pictures, 0);
      if (raw.blocks.length) assert.ok(raw.blocks.every(code => [0, 1, 3].includes(code)));
      if (raw.chunks) assert.deepEqual(raw.chunks.map(value => value.trim()), ['fmt', 'data']);
      const statAfter = fs.statSync(file, { bigint: true });
      assert.equal(statAfter.mtimeNs, statBefore.mtimeNs, 'modified time preserved');
      if (process.platform === 'win32') assert.equal(statAfter.birthtimeNs, statBefore.birthtimeNs, 'creation time preserved');
      if (pcm) assert.equal(tool('pcmHash', file), pcm, 'decoded audio unchanged');
      else assert.deepEqual(fs.readFileSync(file).subarray(92), rawBefore.subarray(92, 92 + 4096), 'DSD payload unchanged');
      const repeatHash = sha(file);
      const repeatStat = fs.statSync(file, { bigint: true });
      const repeat = await audio.clearBatch([{ path: file }]);
      assert.deepEqual(repeat.errors, []);
      assert.equal(repeat.results[0].unchanged, true);
      assert.equal(repeat.results[0].backupSkipped, 'empty');
      assert.equal(sha(file), repeatHash);
      assert.equal(fs.statSync(file, { bigint: true }).ino, repeatStat.ino, 'empty clear does not replace inode');
      noArtifacts(data, directory);
    });
  }
});

test('MP4 chapter-only and tagged normal/faststart files are backed up and cleared without changing audio or dates', async t => {
  for (const faststart of [false, true]) {
    for (const tagged of [false, true]) {
      await t.test(`${faststart ? 'faststart' : 'normal'}-${tagged ? 'tagged' : 'chapter-only'}`, async () => {
        const { directory } = context(`chapters-${faststart}-${tagged}`);
        const source = clone(directory, 'm4a');
        const file = path.join(directory, '章节音频.m4b');
        py(`import subprocess
sys.path.insert(0,sys.argv[4])
import imageio_ffmpeg
meta=Path(sys.argv[1]).with_suffix('.ffmetadata')
meta.write_text(';FFMETADATA1\\n[CHAPTER]\\nTIMEBASE=1/1000\\nSTART=0\\nEND=100\\ntitle=Private chapter title\\n[CHAPTER]\\nTIMEBASE=1/1000\\nSTART=100\\nEND=200\\ntitle=Second private chapter\\n',encoding='utf8')
command=[imageio_ffmpeg.get_ffmpeg_exe(),'-v','error','-y','-i',sys.argv[1],'-i',str(meta),'-map','0:a:0','-map_metadata','1','-map_chapters','1','-c','copy']
if sys.argv[3]=='true': command+=['-movflags','+faststart']
subprocess.run(command+['-f','mp4',sys.argv[2]],check=True)
a=engine.load_audio(Path(sys.argv[2])); a.delete()
if sys.argv[5]=='true':
 a=engine.load_audio(Path(sys.argv[2])); a.tags['\\xa9nam']=['Ordinary title']; a.save()
print(json.dumps(True))`, source, file, String(faststart), path.resolve(__dirname, 'core-tools'), String(tagged));
        const chapterInfo = () => py(`import subprocess,hashlib
sys.path.insert(0,sys.argv[2]); import imageio_ffmpeg
command=[imageio_ffmpeg.get_ffmpeg_exe(),'-v','error','-i',sys.argv[1]]
encoded=subprocess.check_output(command+['-map','0:a:0','-c:a','copy','-f','data','-'])
metadata=subprocess.check_output(command+['-map_chapters','0','-f','ffmetadata','-']).decode('utf8')
a=engine.load_audio(Path(sys.argv[1]))
print(json.dumps({'chapters':len(a.chapters or []),'metadata':metadata,'encodedHash':hashlib.sha256(encoded).hexdigest()}))`, file, path.resolve(__dirname, 'core-tools'));
        const beforeInfo = chapterInfo();
        assert.equal(beforeInfo.chapters, 2);
        assert.match(beforeInfo.metadata, /Private chapter title/);
        const before = await audio.read(file);
        assert.equal(before.hasMetadata, true);
        assert.equal(before.tags.title, tagged ? 'Ordinary title' : '');
        if (!tagged) assert.deepEqual(inspect(file).keys, []);
        const pcm = tool('pcmHash', file);
        const old = new Date('2003-04-05T06:07:08.000Z');
        fs.utimesSync(file, old, old);
        const statBefore = fs.statSync(file, { bigint: true });
        const bytesBefore = fs.readFileSync(file);
        // Refresh the cached stamp after deliberately setting the fixture date.
        await audio.read(file);
        const cleared = await audio.clearBatch([{ path: file }]);
        assert.deepEqual(cleared.errors, []);
        assert.ok(cleared.results[0].backupId, 'chapter-only files need the default safety backup');
        assert.equal(cleared.results[0].unchanged, undefined);
        assert.equal(cleared.results[0].record.hasMetadata, false);
        const history = await audio.history();
        assert.deepEqual(fs.readFileSync(history[0].backupPath), bytesBefore);
        const statAfter = fs.statSync(file, { bigint: true });
        assert.equal(statAfter.mtimeNs, statBefore.mtimeNs);
        if (process.platform === 'win32') assert.equal(statAfter.birthtimeNs, statBefore.birthtimeNs);
        const afterInfo = chapterInfo();
        assert.equal(afterInfo.chapters, 0);
        assert.doesNotMatch(afterInfo.metadata, /CHAPTER|Private chapter|Second private/);
        assert.equal(afterInfo.encodedHash, beforeInfo.encodedHash, 'encoded audio packets remain exact');
        assert.equal(tool('pcmHash', file), pcm, 'decoded audio remains exact');
        assert.equal(fs.readFileSync(file).includes(Buffer.from('Private chapter title')), false);
        assert.equal(fs.readFileSync(file).includes(Buffer.from('Second private chapter')), false);
        const repeat = await audio.clearBatch([{ path: file }]);
        assert.deepEqual(repeat.errors, []);
        assert.equal(repeat.results[0].unchanged, true);
        if (!faststart && !tagged) {
          for (const invalidRange of ['overlap', 'bounds']) {
            const malformed = path.join(directory, `章节范围无效-${invalidRange}.m4b`);
            fs.writeFileSync(malformed, bytesBefore);
            py(`from mutagen.mp4._atom import Atoms
import struct
with open(sys.argv[1],'r+b') as f:
 atoms=Atoms(f); chapter=None; audio_start=None
 for track in atoms[b'moov'].findall(b'trak'):
  handler=track[b'mdia',b'hdlr'].read(f)[1][8:12]
  chunk=track[b'mdia',b'minf',b'stbl',b'stco']
  if handler==b'text': chapter=chunk
  elif handler==b'soun': audio_start=struct.unpack('>I',chunk.read(f)[1][8:12])[0]
 f.seek(chapter.offset+16)
 f.write(struct.pack('>I',audio_start if sys.argv[2]=='overlap' else Path(sys.argv[1]).stat().st_size+4096))
print(json.dumps(True))`, malformed, invalidRange);
            const malformedBytes = fs.readFileSync(malformed);
            const rejected = await audio.clearBatch([{ path: malformed }]);
            assert.equal(rejected.errors[0].code, 'MP4_CHAPTER_ERROR');
            assert.deepEqual(fs.readFileSync(malformed), malformedBytes, 'ambiguous chapter extents never modify the source');
            assert.equal((await audio.history()).length, 1, 'rejected chapter cleanup creates no backup or history entry');
          }
        }
      });
    }
  }
});

test('clearing with default backup restores byte-exact source and always creates a safety backup of the empty current file', async () => {
  const { directory } = context('clear-restore');
  const file = clone(directory, 'flac');
  seedPictures(file);
  const original = sha(file);
  const cleared = await audio.clearBatch([{ path: file }]);
  assert.deepEqual(cleared.errors, []);
  assert.ok(cleared.results[0].backupId);
  assert.equal(cleared.results[0].record.hasMetadata, false);
  const emptyHash = sha(file);
  const restored = await audio.restore(cleared.results[0].backupId);
  assert.equal(sha(file), original);
  assert.equal(restored.record.hasMetadata, true);
  const history = await audio.history();
  assert.equal(history.length, 2);
  const safety = history.find(entry => entry.id === restored.backupId);
  assert.equal(safety.action, 'restore');
  assert.equal(sha(safety.backupPath), emptyHash, 'restore backup bypasses empty-file skip');
});

test('broken history blocks required backups but not disabled or empty-file writes, renames and clears', async () => {
  const { directory, data } = context('corrupt-history');
  fs.mkdirSync(path.join(data, 'backups'), { recursive: true });
  const index = path.join(data, 'backups', 'index.json');
  fs.writeFileSync(index, '{invalid');
  const tagged = clone(directory, 'mp3');
  const sourceHash = sha(tagged);
  const rejected = await audio.clearBatch([{ path: tagged }]);
  assert.equal(rejected.errors[0].code, 'CORRUPT_HISTORY');
  assert.equal(sha(tagged), sourceHash);
  const write = await audio.writeBatch([{ path: tagged, tags: { title: '允许' } }], { backupEnabled: false });
  assert.deepEqual(write.errors, []);
  const renamed = await audio.renameBatch([{ path: tagged }], '无备份重命名', { backupEnabled: false });
  assert.deepEqual(renamed.errors, []);
  const cleared = await audio.clearBatch([{ path: renamed.results[0].newPath }], { backupEnabled: false });
  assert.deepEqual(cleared.errors, []);
  const empty = blank(directory);
  const emptyRename = await audio.renameBatch([{ path: empty }], '空白无备份');
  assert.deepEqual(emptyRename.errors, []);
  const emptyWrite = await audio.writeBatch([{ path: emptyRename.results[0].newPath, tags: { title: '新增' } }]);
  assert.deepEqual(emptyWrite.errors, []);
  assert.equal(emptyWrite.results[0].backupSkipped, 'empty');
  assert.equal(fs.readFileSync(index, 'utf8'), '{invalid');
  assert.deepEqual(fs.readdirSync(path.dirname(index)), ['index.json']);
  assert.deepEqual(fs.readdirSync(directory).filter(name => name.startsWith('.music-tools-')), []);
});

test('clear rejects external modifications even with backups disabled and honors stopOnError', async () => {
  const { directory, data } = context('clear-conflict');
  const file = clone(directory, 'wav');
  await audio.read(file);
  fs.appendFileSync(file, 'external edit');
  const changed = sha(file);
  const next = clone(directory, 'flac');
  const nextHash = sha(next);
  const rejected = await audio.clearBatch([{ path: file }, { path: next }], { backupEnabled: false, stopOnError: true });
  assert.equal(rejected.results.length, 0);
  assert.equal(rejected.errors[0].code, 'EXTERNAL_MODIFICATION');
  assert.equal(sha(file), changed);
  assert.equal(sha(next), nextHash);
  noArtifacts(data, directory);
});

test('clear detects and deletes secondary APEv2 on MP3 and legacy ID3v1 on APE-based streams', async t => {
  for (const extension of ['mp3', 'wv']) {
    await t.test(extension, async () => {
      const { directory } = context('secondary-' + extension);
      const file = clone(directory, extension);
      py(`a=engine.load_audio(Path(sys.argv[1])); a.delete(); print(json.dumps(True))`, file);
      const untaggedBytes = fs.readFileSync(file);
      const pcm = tool('pcmHash', file);
      if (extension === 'mp3') {
        py(`from mutagen.apev2 import APEv2,APEBinaryValue
t=APEv2(); t['Unknown-only']='secondary'; t['Cover Art (Back)']=APEBinaryValue(b'image.png\\0opaque-picture'); t.save(sys.argv[1])
print(json.dumps(True))`, file);
      } else {
        py(`from mutagen.apev2 import APEv2
t=APEv2(); t['Unknown-only']='primary'; t.save(sys.argv[1])
with open(sys.argv[1],'ab') as f: f.write(b'TAG'+b'Legacy title'.ljust(30,b'\\0')+b'\\0'*94+bytes([255]))
print(json.dumps(True))`, file);
      }
      const before = await audio.read(file);
      assert.equal(before.hasMetadata, true);
      assert.ok(Object.values(before.tags).every(value => !value), 'secondary metadata absent from normalized fields');
      const originalHash = sha(file);
      const cleared = await audio.clearBatch([{ path: file }]);
      assert.deepEqual(cleared.errors, []);
      assert.ok(cleared.results[0].backupId);
      assert.equal(cleared.results[0].record.hasMetadata, false);
      assert.deepEqual(fs.readFileSync(file), untaggedBytes, 'encoded audio bytes match the clean baseline');
      // Appended legacy tags can change FFmpeg's gapless trimming decisions.
      // Compare decoding to the clean baseline, and separately verify all bytes.
      assert.equal(tool('pcmHash', file), pcm);
      const remaining = py(`from mutagen.apev2 import APEv2,APENoHeaderError
from mutagen.id3 import ID3,ID3NoHeaderError
found=[]
for cls,err in [(APEv2,APENoHeaderError),(ID3,ID3NoHeaderError)]:
 try: found.append(len(cls(sys.argv[1])))
 except err: found.append(0)
print(json.dumps(found))`, file);
      assert.deepEqual(remaining, [0, 0]);
      const entry = (await audio.history()).find(item => item.id === cleared.results[0].backupId);
      assert.equal(sha(entry.backupPath), originalHash);
    });
  }
});

test('raw detection includes FLAC picture-only files, ID3 opaque frames and native RIFF INFO without normalized tags', async () => {
  const { directory } = context('raw-detection');
  const flac = clone(directory, 'flac');
  seedPictures(flac);
  py(`a=engine.load_audio(Path(sys.argv[1])); a.delete(); print(json.dumps(True))`, flac);
  const pictureOnly = await audio.read(flac);
  assert.equal(pictureOnly.hasMetadata, true);
  assert.ok(Object.values(pictureOnly.tags).every(value => !value));
  assert.ok(pictureOnly.cover);
  const flacClear = await audio.clearBatch([{ path: flac }]);
  assert.deepEqual(flacClear.errors, []);
  assert.ok(flacClear.results[0].backupId);
  const wav = blank(directory, '原生信息.wav');
  py(`from mutagen._riff import RiffFile
with open(sys.argv[1],'r+b') as f:
 r=RiffFile(f); r.root.insert_chunk('LIST',b'INFOINAM'+(6).to_bytes(4,'little')+b'title\\0')
print(json.dumps(True))`, wav);
  const native = await audio.read(wav);
  assert.equal(native.hasMetadata, true);
  assert.ok(Object.values(native.tags).every(value => !value));
  const nativeClear = await audio.clearBatch([{ path: wav }]);
  assert.deepEqual(nativeClear.errors, []);
  assert.ok(nativeClear.results[0].backupId);
  assert.equal(nativeClear.results[0].record.hasMetadata, false);
  const mp3 = clone(directory, 'mp3');
  py(`from mutagen.id3 import ID3
a=engine.load_audio(Path(sys.argv[1])); a.delete(); t=ID3(); t.unknown_frames=[b'ZZZZ'+bytes([0,0,0,4,0,0])+b'data']; t._unknown_v2_version=4; t.save(sys.argv[1])
print(json.dumps(True))`, mp3);
  const opaque = await audio.read(mp3);
  assert.equal(opaque.hasMetadata, true);
  assert.ok(Object.values(opaque.tags).every(value => !value));
  assert.equal(inspect(mp3).unknownFrames, 1);
  const opaqueClear = await audio.clearBatch([{ path: mp3 }]);
  assert.deepEqual(opaqueClear.errors, []);
  assert.ok(opaqueClear.results[0].backupId);
  assert.equal(opaqueClear.results[0].record.hasMetadata, false);
});
