"""Generate small disposable audio fixtures. Test-only FFmpeg lives in tests/core-tools."""
import hashlib
import json
from pathlib import Path
import struct
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'source' / 'vendor' / 'python-libs'))
sys.path.insert(0, str(ROOT / 'tests' / 'core-tools'))
import mutagen
from mutagen.id3 import ID3, TXXX, COMM, APIC
from mutagen.mp4 import MP4, MP4FreeForm
from mutagen.asf import ASF
from mutagen.apev2 import APEv2


def ffmpeg():
    import imageio_ffmpeg
    return imageio_ffmpeg.get_ffmpeg_exe()


def unknown(path):
    audio = mutagen.File(str(path))
    if audio.tags is None:
        audio.add_tags()
    tags = audio.tags
    if isinstance(tags, ID3):
        tags.add(TXXX(encoding=3, desc='MusicTag-preservation-test', text=['preserve-me-原始']))
        tags.add(COMM(encoding=3, lang='fra', desc='unrelated', text=['French comment']))
    elif isinstance(audio, MP4):
        tags['----:org.musictag.test:unknown'] = [MP4FreeForm('preserve-me-原始'.encode())]
    elif isinstance(audio, ASF):
        tags['MusicTag-preservation-test'] = ['preserve-me-原始']
    else:
        tags['MusicTag-preservation-test'] = 'preserve-me-原始'
    audio.save()


def inspect(path):
    audio = mutagen.File(str(path))
    tags = audio.tags
    if isinstance(tags, ID3):
        value = str(tags['TXXX:MusicTag-preservation-test'])
        other_comment = str(tags['COMM:unrelated:fra'])
    elif isinstance(audio, MP4):
        value = bytes(tags['----:org.musictag.test:unknown'][0]).decode()
        other_comment = None
    elif isinstance(audio, ASF):
        value = str(tags['MusicTag-preservation-test'][0])
        other_comment = None
    else:
        item = tags['MusicTag-preservation-test']
        value = str(item[0] if isinstance(item, list) else item)
        other_comment = None
    return {'unknown': value, 'otherComment': other_comment}


def pcm_hash(path):
    output = path.with_name(path.name + '.decode.raw')
    try:
        subprocess.run([ffmpeg(), '-v', 'error', '-y', '-i', str(path), '-f', 's16le', '-acodec', 'pcm_s16le', str(output)], check=True)
        return hashlib.sha256(output.read_bytes()).hexdigest()
    finally:
        output.unlink(missing_ok=True)


def build(folder):
    folder.mkdir(parents=True, exist_ok=True)
    codecs = {'wav': 'pcm_s16le', 'mp3': 'libmp3lame', 'flac': 'flac', 'm4a': 'aac', 'ogg': 'libvorbis',
              'opus': 'libopus', 'aiff': 'pcm_s16be', 'wma': 'wmav2', 'wv': 'wavpack'}
    files = []
    for extension, codec in codecs.items():
        path = folder / ('音频样本-原始.' + extension)
        subprocess.run([ffmpeg(), '-v', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100:duration=0.2', '-c:a', codec, str(path)], check=True)
        unknown(path)
        files.append(str(path))
    # Valid DSF container with one mono 4096-byte DSD block.
    path = folder / '音频样本-原始.dsf'
    payload = bytes([0x69]) * 4096
    total_size = 28 + 52 + 12 + len(payload)
    header = struct.pack('<4sQQQ', b'DSD ', 28, total_size, 0)
    fmt = struct.pack('<4sQIIIIIIQII', b'fmt ', 52, 1, 0, 1, 1, 2822400, 1, len(payload) * 8, 4096, 0)
    path.write_bytes(header + fmt + struct.pack('<4sQ', b'data', 12 + len(payload)) + payload)
    unknown(path)
    files.append(str(path))
    return files


if __name__ == '__main__':
    command, target = sys.argv[1:3]
    if command == 'build':
        result = build(Path(target))
    elif command == 'inspect':
        result = inspect(Path(target))
    elif command == 'seed':
        result = unknown(Path(target))
    elif command == 'cleanApeSeed':
        # The old public sample misflags binary art as UTF-8 text. Normalize
        # only this disposable fixture; production never drops invalid tags.
        APEv2().delete(target)
        result = unknown(Path(target))
    elif command == 'pcmHash':
        result = pcm_hash(Path(target))
    else:
        raise SystemExit('Unknown command')
    print(json.dumps(result, ensure_ascii=False))
