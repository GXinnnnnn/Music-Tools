# Portable audio core

`audio.cjs` is the Node CommonJS entry point. `engine.py` receives one UTF-8 JSON request on stdin and returns one JSON response on stdout. It uses bundled Mutagen 1.48.1 from `source/vendor/python-libs`, explicitly inserted into `sys.path` so an isolated embedded Python runtime works.

```js
const audio = require('./source/core/audio.cjs');
audio.setDataDir('D:/Music Tools/data');
audio.setPythonPath('D:/Music Tools/source/vendor/python/python.exe');
const { files, errors } = await audio.scan(['D:/Music']);
const record = await audio.read(files[0].path);
const result = await audio.writeBatch([
  { path: record.path, stamp: record.stamp, tags: { title: 'New title' } },
]);
await audio.restore(result.results[0].backupId);
```

The portable runtime is discovered at `source/vendor/python/python.exe`, then `vendor/python/python.exe`; `MUSIC_TOOLS_PYTHON` and `setPythonPath()` are explicit overrides. No system Python lookup is performed. The host application should always call `setDataDir()` to point to its writable portable data folder. The default is the project root's `data` folder.

## API

- `async scan(paths)` accepts files/directories, recursively follows directories with cycle detection, skips unrelated extensions, and returns `{ files, errors }`. Repeated canonical paths are deduplicated. Corrupt/unsupported audio files appear in `errors` without discarding other results.
- `async read(path)` returns `{ id, path, filename, format, size, duration, bitrate, sampleRate, channels, tags, cover, stamp }`. Duration is seconds; bitrate is bits per second; sampleRate is Hz. Tags are strings. Missing tags and cover are empty strings. Cover is a base64 image data URI. Stamp contains `{size,mtimeNs,sha256}`; `mtimeNs` is a string to retain integer precision.
- `async writeBatch(jobs, options={})` accepts `{path,tags,cover?,stamp?}`. `tags` is a partial field object. Omitted fields remain untouched; `''`/`null` clears a field. Cover may also appear inside `tags`. The result is `{results:[{path,backupId,record}], errors:[{path,code,message}]}`. `options.stopOnError` stops after the first failed job. Prior successful files are retained and backed up.
- `async history()` returns newest-first backup entries containing `id,action,originalPath,path,backupPath,beforeStamp,afterStamp,status,createdAt`, optionally `restoredAt` and `restoresId`.
- `async restore(id)` checks that current audio still matches the selected operation's `afterStamp`, verifies backup SHA-256, and returns `{path,backupId,record,restoredId}`. Restoration itself creates a new full backup. Rename restoration returns the previous filename and never replaces another existing filename. Already-restored entries are rejected.
- `async renamePreview(jobs, pattern)` returns `{results:[{path,newPath,filename,unchanged,stamp}],errors}`. Supports `{title}`, `{artist}`, `{album}`, `{albumArtist}`, `{year}`, `{track}`, `{disc}`, `{genre}`, `{composer}`, `{lyricist}`, `{filename}`, `{format}` and other readable tag fields; `{track:02}` / `{disc:02}` zero-pad numbers. `%artist%` aliases are accepted. `filename` excludes extension; the original audio extension is always preserved. Windows forbidden characters and reserved names are sanitized. Existing or duplicate targets are rejected.
- `async renameBatch(jobs, pattern)` applies valid preview jobs with full backups and returns `{results:[{path,newPath,backupId,record}],errors}`. No-change jobs return `unchanged:true` without creating a backup.
- `async exportSidecars(jobs, options={})` exports readable cover and lyrics beside the audio or into `options.directory`. `lyrics` and `cover` default to true. Timed lyrics use `.lrc`, plain lyrics `.txt`, and covers retain PNG/JPEG/GIF/WebP binary data. The audio stem prefixes each sidecar. `overwrite` defaults to false. Returns `{results:[{path,files:[...]}],errors}`. It does not modify the audio.

Writable fields: `title,artist,album,albumArtist,year,track,disc,genre,composer,lyricist,comment,lyrics`, plus `cover`. MP4 and Vorbis track/disc must be a number or `number/total`, maximum 65535. MP4 embedded covers support JPEG/PNG. Other supported containers keep their applicable cover encoding.

## Safety and format scope

All audio content is copied in full before modification. Metadata is changed only in a temporary sibling file, the staged result is parsed for validity, and the untouched original is saved to `data/backups/<id>.<ext>` with an atomically published JSON index before the sibling replaces it. A process lock prevents two engine processes from mutating the same data directory concurrently. Successful earlier files remain usable when another file in a batch fails.

SHA-256, size, and nanosecond mtime detect external edits before staging and immediately before replacement. Pass the displayed record's stamp for explicit optimistic concurrency. When a stamp is omitted, the Node module uses its most recently observed stamp for that canonical path, if any; an unseen path is checked against the state at operation start. The host should pass stamps when persisting records across app sessions. Like ordinary filesystem APIs, the final check and replacement cannot stop a separate program from writing in the tiny interval between those calls; do not deliberately run competing editors against the same file.

Mutagen updates existing tag containers without reconstructing unrelated metadata. Unknown custom tags, non-front cover images, and unrelated ID3 comments/lyrics with other descriptions or languages are preserved. Editing a field replaces that field and common equivalent aliases. Front covers are replaced/cleared independently of other picture types. Read displays the front cover when present, otherwise the first available picture. Multi-valued text is exposed as a `; `-joined string; editing it writes one string value.

The scanner recognizes MP3, FLAC, M4A/M4B/MP4, OGG/OGA, OPUS, WAV/WAVE, AIFF/AIF/AIFC, APE, WMA/ASF, WV, DSF, DFF/DSDIFF, TTA, MPC, OFR/OFS and SPX extensions. Actual readable/writable support depends on Mutagen's parser and the file's tag container. Corrupt, unsupported or read-only formats produce per-file errors; an extension alone is not a support guarantee. No transcoding occurs. Mutagen is GPL-2.0-or-later; its bundled distribution metadata contains its license.

## Tests

`node --test tests/core-audio.test.cjs` creates all music in a temporary OS directory and removes it afterward. `MUSIC_TOOLS_TEST_PYTHON` selects the test interpreter. Test tooling is isolated in `tests/core-tools` (imageio-ffmpeg); it is not an application runtime dependency. The fixture helper creates real sine-wave WAV, MP3, FLAC, M4A, OGG, OPUS, AIFF, WMA and WV files and a valid raw DSD DSF container. Tests check all field roundtrips, cover handling, unrelated metadata preservation, decoded PCM hashes, byte-exact backup/restore, recursive scan, failure isolation, external modifications, rename collisions and undo, sidecars, corrupted-backup rejection, invalid-index rejection, and recovery after replacement with a still-pending backup index entry.

Before the audio suite, run `npm run bootstrap:python` and `npm run bootstrap:tests`. Fixture tooling is downloaded separately from the pinned imageio-ffmpeg 0.7.0 wheel on PyPI and verified against its published SHA-256. It is excluded from Git, source archives, and application packages.
