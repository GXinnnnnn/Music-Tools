"""UTF-8 JSON bridge for Mutagen. No user Python installation is required."""
from __future__ import annotations

import base64
import contextlib
import datetime
import hashlib
import json
import mimetypes
import os
from pathlib import Path
import re
import shutil
import struct
import sys
import tempfile
import uuid

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'vendor' / 'python-libs'))
import mutagen
from mutagen.id3 import ID3, APIC, COMM, USLT, TXXX, Frames
from mutagen.flac import FLAC, Picture
from mutagen.mp4 import MP4, MP4Cover, MP4FreeForm
from mutagen.asf import ASF, ASFByteArrayAttribute
from mutagen.apev2 import APEv2, APEBinaryValue

FIELDS = ('title', 'artist', 'album', 'albumArtist', 'year', 'track', 'disc', 'genre', 'composer', 'lyricist', 'comment', 'lyrics')
EXTENSIONS = {'.mp3', '.flac', '.m4a', '.m4b', '.mp4', '.ogg', '.oga', '.opus', '.wav', '.wave', '.aif', '.aiff', '.aifc', '.ape', '.wma', '.asf', '.wv', '.dsf', '.dff', '.dsdiff', '.tta', '.mpc', '.ofr', '.ofs', '.spx'}
ID3_MAP = dict(zip(FIELDS, ('TIT2', 'TPE1', 'TALB', 'TPE2', 'TDRC', 'TRCK', 'TPOS', 'TCON', 'TCOM', 'TEXT', 'COMM', 'USLT')))
VORBIS_MAP = dict(zip(FIELDS, ('title', 'artist', 'album', 'albumartist', 'date', 'tracknumber', 'discnumber', 'genre', 'composer', 'lyricist', 'comment', 'lyrics')))
APE_MAP = dict(zip(FIELDS, ('Title', 'Artist', 'Album', 'Album Artist', 'Year', 'Track', 'Disc', 'Genre', 'Composer', 'Lyricist', 'Comment', 'Lyrics')))
ASF_MAP = dict(zip(FIELDS, ('Title', 'Author', 'WM/AlbumTitle', 'WM/AlbumArtist', 'WM/Year', 'WM/TrackNumber', 'WM/PartOfSet', 'WM/Genre', 'WM/Composer', 'WM/Writer', 'Description', 'WM/Lyrics')))
MP4_MAP = dict(zip(FIELDS, ('\xa9nam', '\xa9ART', '\xa9alb', 'aART', '\xa9day', 'trkn', 'disk', '\xa9gen', '\xa9wrt', '----:com.apple.iTunes:LYRICIST', '\xa9cmt', '\xa9lyr')))
DATA_DIR = None


class EngineError(Exception):
    def __init__(self, message, code='ENGINE_ERROR'):
        super().__init__(message)
        self.code = code


def error_item(path, error):
    return {'path': str(path or ''), 'code': getattr(error, 'code', type(error).__name__), 'message': str(error)}


def canonical(path):
    if not isinstance(path, (str, os.PathLike)) or not str(path).strip():
        raise EngineError('文件路径不能为空', 'INVALID_PATH')
    return Path(path).expanduser().resolve()


def stamp(path):
    stat = path.stat()
    digest = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b''):
            digest.update(chunk)
    after = path.stat()
    if (stat.st_size, stat.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
        raise EngineError('读取期间文件已被外部修改，请重新扫描', 'EXTERNAL_MODIFICATION')
    return {'size': stat.st_size, 'mtimeNs': str(stat.st_mtime_ns), 'sha256': digest.hexdigest()}


def same_stamp(a, b):
    if not a or not b:
        return False
    return a.get('sha256') == b.get('sha256') and a.get('size') == b.get('size') and str(a.get('mtimeNs')) == str(b.get('mtimeNs'))


def check_stamp(path, expected):
    current = stamp(path)
    if expected is not None and not same_stamp(current, expected):
        raise EngineError('文件已被外部修改，请重新扫描后再操作', 'EXTERNAL_MODIFICATION')
    return current


def load_audio(path):
    audio = mutagen.File(str(path), easy=False)
    if audio is None:
        raise EngineError('Mutagen 无法识别此音频格式', 'UNSUPPORTED_FORMAT')
    return audio


def text_value(value):
    if value is None:
        return ''
    if isinstance(value, (list, tuple)):
        return '; '.join(text_value(item) for item in value)
    if isinstance(value, bytes):
        return value.decode('utf-8', errors='replace').rstrip('\x00')
    return str(value)


def mime_for(data, fallback='image/jpeg'):
    if data.startswith(b'\x89PNG\r\n\x1a\n'):
        return 'image/png'
    if data.startswith(b'\xff\xd8\xff'):
        return 'image/jpeg'
    if data.startswith((b'GIF87a', b'GIF89a')):
        return 'image/gif'
    if data[:4] == b'RIFF' and data[8:12] == b'WEBP':
        return 'image/webp'
    return fallback


def data_uri(data, mime=None):
    return 'data:' + (mime or mime_for(data)) + ';base64,' + base64.b64encode(data).decode('ascii') if data else ''


def parse_cover(value):
    if value in ('', None):
        return None
    if not isinstance(value, str):
        raise EngineError('封面必须是图片 data URI 或空字符串', 'INVALID_COVER')
    match = re.fullmatch(r'data:(image/[\w.+-]+);base64,([\s\S]+)', value)
    if not match:
        raise EngineError('封面必须是图片 base64 data URI', 'INVALID_COVER')
    try:
        raw = base64.b64decode(match[2], validate=True)
    except ValueError as exc:
        raise EngineError('封面 base64 数据无效', 'INVALID_COVER') from exc
    if not raw or len(raw) > 32 * 1024 * 1024:
        raise EngineError('封面为空或超过 32 MB', 'INVALID_COVER')
    return raw, mime_for(raw, match[1])


def asf_picture(data):
    if len(data) < 5:
        return None
    kind, size = struct.unpack('<BI', data[:5])
    offset = 5
    values = []
    for _ in range(2):
        end = offset
        while end + 1 < len(data) and data[end:end + 2] != b'\0\0':
            end += 2
        values.append(data[offset:end].decode('utf-16-le', errors='replace'))
        offset = end + 2
    return kind, data[offset:offset + size], values[0]


def read_tags(audio):
    result = {field: '' for field in FIELDS}
    tags = audio.tags
    cover = ''
    if tags is None:
        return result, cover
    if isinstance(tags, ID3):
        for field, key in ID3_MAP.items():
            values = tags.getall(key)
            if values:
                if field in ('comment', 'lyrics'):
                    values.sort(key=lambda frame: (bool(frame.desc), getattr(frame, 'lang', '') != 'eng'))
                result[field] = text_value(values[0].text)
        pictures = tags.getall('APIC')
        pictures.sort(key=lambda picture: picture.type != 3)
        if pictures:
            cover = data_uri(pictures[0].data, pictures[0].mime)
    elif isinstance(audio, MP4):
        for field, key in MP4_MAP.items():
            value = tags.get(key)
            if field in ('track', 'disc') and value:
                number, total = value[0]
                result[field] = str(number) + ('/' + str(total) if total else '')
            else:
                result[field] = text_value(value)
        if tags.get('covr'):
            cover = data_uri(bytes(tags['covr'][0]))
    elif isinstance(audio, ASF):
        for field, key in ASF_MAP.items():
            result[field] = text_value(tags.get(key))
        pictures = []
        for value in tags.get('WM/Picture', []):
            with contextlib.suppress(Exception):
                pictures.append(asf_picture(value.value))
        pictures = [picture for picture in pictures if picture]
        pictures.sort(key=lambda picture: picture[0] != 3)
        if pictures:
            cover = data_uri(pictures[0][1], pictures[0][2])
    elif isinstance(tags, APEv2):
        for field, key in APE_MAP.items():
            result[field] = text_value(tags.get(key))
        value = tags.get('Cover Art (Front)')
        if value is not None:
            raw = bytes(value)
            _, _, raw = raw.partition(b'\x00')
            cover = data_uri(raw)
    else:
        for field, key in VORBIS_MAP.items():
            result[field] = text_value(tags.get(key))
        # Common aliases are readable; untouched fields are retained on save.
        for field, alias in [('albumArtist', 'album artist'), ('year', 'year'), ('comment', 'description'), ('lyrics', 'unsyncedlyrics')]:
            if not result[field]:
                result[field] = text_value(tags.get(alias))
        for field, total_key in [('track', 'tracktotal'), ('disc', 'disctotal')]:
            total = text_value(tags.get(total_key) or tags.get('totaltracks' if field == 'track' else 'totaldiscs'))
            if total and result[field] and '/' not in result[field]:
                result[field] += '/' + total
        if isinstance(audio, FLAC):
            pictures = sorted(audio.pictures, key=lambda picture: picture.type != 3)
            if pictures:
                cover = data_uri(pictures[0].data, pictures[0].mime)
        elif tags.get('metadata_block_picture'):
            pictures = []
            for value in tags['metadata_block_picture']:
                with contextlib.suppress(Exception):
                    pictures.append(Picture(base64.b64decode(value)))
            pictures.sort(key=lambda picture: picture.type != 3)
            if pictures:
                cover = data_uri(pictures[0].data, pictures[0].mime)
        elif tags.get('coverart'):
            with contextlib.suppress(Exception):
                cover = data_uri(base64.b64decode(tags['coverart'][0]))
    return result, cover


def read_record(path):
    path = canonical(path)
    before = stamp(path)
    audio = load_audio(path)
    tags, cover = read_tags(audio)
    after = path.stat()
    if after.st_size != before['size'] or str(after.st_mtime_ns) != before['mtimeNs']:
        raise EngineError('读取期间文件已被外部修改，请重新扫描', 'EXTERNAL_MODIFICATION')
    info = audio.info
    return {'id': hashlib.sha256(os.path.normcase(str(path)).encode('utf-8')).hexdigest()[:20],
            'path': str(path), 'filename': path.name, 'format': type(audio).__name__.upper(),
            'size': before['size'], 'duration': round(getattr(info, 'length', 0) or 0, 3),
            'bitrate': int(getattr(info, 'bitrate', 0) or 0), 'sampleRate': int(getattr(info, 'sample_rate', 48000 if type(audio).__name__ == 'OggOpus' else 0) or 0),
            'channels': int(getattr(info, 'channels', 0) or 0), 'bitsPerSample': int(getattr(info, 'bits_per_sample', 0) or 0), 'modifiedAt': path.stat().st_mtime * 1000, 'tags': tags, 'cover': cover, 'stamp': before}


def number_pair(value):
    if value == '':
        return None
    match = re.fullmatch(r'\s*(\d+)(?:\s*/\s*(\d+))?\s*', value)
    if not match or int(match[1]) > 65535 or int(match[2] or 0) > 65535:
        raise EngineError('曲目/碟片编号应为数字或 数字/总数（0–65535）', 'INVALID_NUMBER')
    return int(match[1]), int(match[2] or 0)


def remove_tag(tags, key):
    # Mutagen's dictionary wrappers do not all implement dict.pop(key, default).
    with contextlib.suppress(KeyError):
        del tags[key]


def write_tags(path, changes, cover_marker=False, cover_value=None):
    if not isinstance(changes, dict):
        raise EngineError('tags 必须为字段对象', 'INVALID_TAGS')
    unknown = set(changes) - set(FIELDS) - {'cover'}
    if unknown:
        raise EngineError('不支持的标签字段: ' + ', '.join(sorted(unknown)), 'INVALID_TAGS')
    if 'cover' in changes and not cover_marker:
        cover_marker, cover_value = True, changes['cover']
    updates = {key: '' if value is None else text_value(value) for key, value in changes.items() if key in FIELDS}
    picture = parse_cover(cover_value) if cover_marker else None
    audio = load_audio(path)
    if audio.tags is None:
        audio.add_tags()
    tags = audio.tags
    if isinstance(tags, ID3):
        for field, value in updates.items():
            key = ID3_MAP[field]
            if field in ('comment', 'lyrics'):
                # Only replace the app's default entry. Retain other descriptions/languages.
                for frame in list(tags.getall(key)):
                    if not frame.desc and frame.lang in ('eng', 'XXX', 'und'):
                        del tags[frame.HashKey]
                if value:
                    frame_type = COMM if field == 'comment' else USLT
                    tags.add(frame_type(encoding=3, lang='eng', desc='', text=value))
            else:
                tags.delall(key)
                if value:
                    tags.add(Frames[key](encoding=3, text=[value]))
        if cover_marker:
            for frame in list(tags.getall('APIC')):
                if frame.type == 3:
                    del tags[frame.HashKey]
            if picture:
                data, mime = picture
                # Distinct description avoids replacing non-front images with the same key.
                desc = 'Music Tools Front Cover'
                tags.add(APIC(encoding=3, mime=mime, type=3, desc=desc, data=data))
        audio.save()
    elif isinstance(audio, MP4):
        for field, value in updates.items():
            key = MP4_MAP[field]
            remove_tag(tags, key)
            if value:
                if field in ('track', 'disc'):
                    tags[key] = [number_pair(value)]
                elif key.startswith('----:'):
                    tags[key] = [MP4FreeForm(value.encode('utf-8'))]
                else:
                    tags[key] = [value]
        if cover_marker:
            remove_tag(tags, 'covr')
            if picture:
                data, mime = picture
                if mime not in ('image/png', 'image/jpeg'):
                    raise EngineError('M4A/MP4 封面只支持 JPEG 或 PNG', 'INVALID_COVER')
                tags['covr'] = [MP4Cover(data, imageformat=MP4Cover.FORMAT_PNG if mime == 'image/png' else MP4Cover.FORMAT_JPEG)]
        audio.save()
    elif isinstance(audio, ASF):
        for field, value in updates.items():
            key = ASF_MAP[field]
            remove_tag(tags, key)
            if value:
                tags[key] = [value]
        if cover_marker:
            retained = []
            for value in tags.get('WM/Picture', []):
                try:
                    parsed = asf_picture(value.value)
                    if not parsed or parsed[0] != 3:
                        retained.append(value)
                except Exception:
                    retained.append(value)
            if picture:
                data, mime = picture
                raw = struct.pack('<BI', 3, len(data)) + mime.encode('utf-16-le') + b'\0\0\0\0' + data
                retained.append(ASFByteArrayAttribute(raw))
            if retained:
                tags['WM/Picture'] = retained
            else:
                remove_tag(tags, 'WM/Picture')
        audio.save()
    elif isinstance(tags, APEv2):
        for field, value in updates.items():
            key = APE_MAP[field]
            remove_tag(tags, key)
            if value:
                tags[key] = value
        if cover_marker:
            remove_tag(tags, 'Cover Art (Front)')
            if picture:
                data, mime = picture
                tags['Cover Art (Front)'] = APEBinaryValue(('cover' + (mimetypes.guess_extension(mime) or '.jpg')).encode('utf-8') + b'\0' + data)
        audio.save()
    else:
        for field, value in updates.items():
            key = VORBIS_MAP[field]
            remove_tag(tags, key)
            if field in ('track', 'disc'):
                for alias in (('tracktotal', 'totaltracks') if field == 'track' else ('disctotal', 'totaldiscs')):
                    remove_tag(tags, alias)
                if value:
                    pair = number_pair(value)
                    tags[key] = [str(pair[0])]
                    if pair[1]:
                        tags['tracktotal' if field == 'track' else 'disctotal'] = [str(pair[1])]
            elif value:
                tags[key] = [value]
            if field in ('albumArtist', 'year', 'comment', 'lyrics'):
                alias = {'albumArtist': 'album artist', 'year': 'year', 'comment': 'description', 'lyrics': 'unsyncedlyrics'}[field]
                remove_tag(tags, alias)
        if cover_marker:
            if isinstance(audio, FLAC):
                retained = [item for item in audio.pictures if item.type != 3]
                audio.clear_pictures()
                for item in retained:
                    audio.add_picture(item)
                if picture:
                    data, mime = picture
                    item = Picture()
                    item.type, item.mime, item.data = 3, mime, data
                    audio.add_picture(item)
            else:
                retained = []
                for value in tags.get('metadata_block_picture', []):
                    try:
                        if Picture(base64.b64decode(value)).type != 3:
                            retained.append(value)
                    except Exception:
                        retained.append(value)
                if picture:
                    data, mime = picture
                    item = Picture()
                    item.type, item.mime, item.data = 3, mime, data
                    retained.append(base64.b64encode(item.write()).decode('ascii'))
                if retained:
                    tags['metadata_block_picture'] = retained
                else:
                    remove_tag(tags, 'metadata_block_picture')
                remove_tag(tags, 'coverart')
                remove_tag(tags, 'coverartmime')
        audio.save()


def index_path():
    return DATA_DIR / 'backups' / 'index.json'


def get_history():
    file = index_path()
    if not file.exists():
        return []
    try:
        entries = json.loads(file.read_text(encoding='utf-8'))
        if not isinstance(entries, list):
            raise ValueError('not a list')
        return entries
    except (ValueError, OSError) as exc:
        raise EngineError('备份索引无法读取，已停止修改以保护历史记录: ' + str(exc), 'CORRUPT_HISTORY') from exc


def atomic_bytes(path, content, overwrite=True):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.music-tools-', suffix=path.suffix, dir=str(path.parent))
    try:
        with os.fdopen(fd, 'wb') as handle:
            handle.write(content)
            handle.flush()
            os.fsync(handle.fileno())
        if not overwrite:
            # Windows rename is atomic/no-clobber and also works on FAT/exFAT.
            if os.name == 'nt':
                os.rename(temporary, str(path))
            else:
                os.link(temporary, str(path))
        else:
            os.replace(temporary, str(path))
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temporary)


def save_history(entries):
    atomic_bytes(index_path(), json.dumps(entries, ensure_ascii=False, indent=2).encode('utf-8'))


@contextlib.contextmanager
def mutation_lock():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    handle = (DATA_DIR / '.audio-engine.lock').open('a+b')
    try:
        handle.seek(0)
        if os.name == 'nt':
            import msvcrt
            try:
                msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError as exc:
                raise EngineError('另一个音频任务正在运行，请稍后重试', 'ENGINE_BUSY') from exc
        else:
            import fcntl
            try:
                fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError as exc:
                raise EngineError('另一个音频任务正在运行，请稍后重试', 'ENGINE_BUSY') from exc
        yield
    finally:
        handle.close()


def create_backup(path, before, action, target=None, extra=None):
    entries = get_history()
    identity = uuid.uuid4().hex
    destination = DATA_DIR / 'backups' / (identity + path.suffix)
    destination.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix='.backup-', dir=str(destination.parent))
    os.close(fd)
    try:
        shutil.copy2(path, temporary)
        if stamp(Path(temporary))['sha256'] != before['sha256']:
            raise EngineError('备份期间文件已改变，操作取消', 'EXTERNAL_MODIFICATION')
        with open(temporary, 'r+b') as handle:
            os.fsync(handle.fileno())
        os.replace(temporary, destination)
    finally:
        with contextlib.suppress(FileNotFoundError):
            os.unlink(temporary)
    entry = {'id': identity, 'action': action, 'originalPath': str(path), 'path': str(target or path),
             'filename': path.name, 'backupPath': str(destination), 'beforeStamp': before,
             'afterStamp': None, 'status': 'pending', 'createdAt': datetime.datetime.now(datetime.timezone.utc).isoformat()}
    if extra:
        entry.update(extra)
    entries.append(entry)
    save_history(entries)
    return entry


def update_entry(identity, **values):
    entries = get_history()
    entry = next(item for item in entries if item['id'] == identity)
    entry.update(values)
    save_history(entries)
    return entry


def replace_transaction(path, expected, modifier=None, restore_source=None, action='write', extra=None):
    before = check_stamp(path, expected)
    fd, temporary = tempfile.mkstemp(prefix='.music-tools-', suffix=path.suffix, dir=str(path.parent))
    os.close(fd)
    temporary = Path(temporary)
    entry = None
    committed = False
    try:
        shutil.copy2(restore_source or path, temporary)
        if modifier:
            modifier(temporary)
        # Validate the staged audio before touching the original.
        staged = read_record(temporary)
        with temporary.open('r+b') as handle:
            os.fsync(handle.fileno())
        check_stamp(path, before)
        entry = create_backup(path, before, action, extra={**(extra or {}), 'afterStamp': staged['stamp']})
        check_stamp(path, before)
        os.replace(temporary, path)
        committed = True
        after = stamp(path)
        update_entry(entry['id'], status='complete', afterStamp=after)
        # Reuse staged tags/info while exposing the actual final path/id.
        record = {**staged, 'path': str(path), 'filename': path.name, 'stamp': after,
                  'id': hashlib.sha256(os.path.normcase(str(path)).encode('utf-8')).hexdigest()[:20]}
        return {'path': str(path), 'backupId': entry['id'], 'record': record}
    except Exception as exc:
        if entry:
            with contextlib.suppress(Exception):
                update_entry(entry['id'], status='committed' if committed else 'failed', error=str(exc), afterStamp=stamp(path) if committed else None)
        raise
    finally:
        with contextlib.suppress(FileNotFoundError):
            temporary.unlink()


def scan(paths):
    files, errors, seen, directories = [], [], set(), set()
    pending = list(reversed(paths))
    while pending:
        raw = pending.pop()
        try:
            path = canonical(raw)
            key = os.path.normcase(str(path))
            if path.is_dir():
                if key in directories:
                    continue
                directories.add(key)
                # Resolve directory links and track them to prevent recursion cycles.
                pending.extend(reversed(sorted(path.iterdir(), key=lambda item: item.name.casefold())))
                continue
            if key in seen:
                continue
            seen.add(key)
            if not path.exists():
                raise FileNotFoundError('文件不存在: ' + str(path))
            if path.suffix.lower() not in EXTENSIONS:
                continue
            files.append(read_record(path))
        except Exception as exc:
            errors.append(error_item(raw, exc))
    return {'files': files, 'errors': errors}


def write_batch(jobs, options):
    results, errors = [], []
    for job in jobs:
        try:
            path = canonical(job.get('path'))
            changes = job.get('tags', job.get('changes', {}))
            if not changes and 'cover' not in job:
                raise EngineError('没有需要写入的字段', 'EMPTY_CHANGES')
            result = replace_transaction(path, job.get('stamp'), lambda temporary: write_tags(temporary, changes, 'cover' in job, job.get('cover')))
            results.append(result)
        except Exception as exc:
            errors.append(error_item(job.get('path'), exc))
            if options.get('stopOnError'):
                break
    return {'results': results, 'errors': errors}


def clean_filename(value):
    value = re.sub(r'[<>:"/\\|?*\x00-\x1f]', '_', value)
    value = value.strip().rstrip('. ')
    if re.match(r'^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)', value, re.I):
        value = '_' + value
    if not value or value in ('.', '..'):
        raise EngineError('重命名结果为空', 'INVALID_FILENAME')
    if len(value.encode('utf-16-le')) // 2 > 220:
        raise EngineError('重命名结果过长，请缩短模板', 'INVALID_FILENAME')
    return value


def rename_preview(jobs, pattern):
    results, errors, targets = [], [], set()
    pattern = pattern or '{artist} - {title}'
    for job in jobs:
        try:
            path = canonical(job.get('path'))
            record = read_record(path)
            if job.get('stamp') and not same_stamp(record['stamp'], job['stamp']):
                raise EngineError('文件已被外部修改，请重新扫描后再操作', 'EXTERNAL_MODIFICATION')
            values = {**record['tags'], **(job.get('tags') or {}), 'filename': path.stem, 'format': path.suffix.lstrip('.')}
            def token(match):
                field, width = match[1], match[2]
                if field not in values:
                    raise EngineError('未知模板字段: ' + field, 'INVALID_PATTERN')
                value = text_value(values[field])
                if width:
                    if field not in ('track', 'disc') or not re.fullmatch(r'0?[1-9]\d?', width):
                        raise EngineError('只允许对 track/disc 使用数字补零，例如 {track:02}', 'INVALID_PATTERN')
                    value = value.split('/')[0].zfill(int(width))
                return value or '未知'
            normalized = re.sub(r'%([A-Za-z]+)%', r'{\1}', pattern)
            placeholder = r'\{([A-Za-z]+)(?::([^}]+))?\}'
            remainder = re.sub(placeholder, '', normalized)
            if '{' in remainder or '}' in remainder:
                raise EngineError('模板括号不匹配', 'INVALID_PATTERN')
            rendered = re.sub(placeholder, token, normalized)
            # Patterns represent a stem; avoid accidentally doubling the existing extension.
            if rendered.lower().endswith(path.suffix.lower()):
                rendered = rendered[:-len(path.suffix)]
            target = path.with_name(clean_filename(rendered) + path.suffix)
            key = os.path.normcase(str(target))
            if key in targets:
                raise EngineError('多个文件将重命名为同一文件', 'NAME_COLLISION')
            targets.add(key)
            unchanged = str(path) == str(target)
            if target.exists() and os.path.normcase(str(path)) != key:
                raise EngineError('目标文件已存在: ' + target.name, 'NAME_COLLISION')
            results.append({'path': str(path), 'newPath': str(target), 'filename': target.name,
                            'unchanged': unchanged, 'stamp': record['stamp']})
        except Exception as exc:
            errors.append(error_item(job.get('path'), exc))
    return {'results': results, 'errors': errors}


def rename_batch(jobs, pattern):
    preview = rename_preview(jobs, pattern)
    results, errors = [], list(preview['errors'])
    for item in preview['results']:
        entry = None
        committed = False
        try:
            path, target = Path(item['path']), Path(item['newPath'])
            if item['unchanged']:
                results.append({'path': str(path), 'newPath': str(target), 'unchanged': True, 'record': read_record(path)})
                continue
            before = check_stamp(path, item['stamp'])
            entry = create_backup(path, before, 'rename', target=target, extra={'afterStamp': before})
            check_stamp(path, before)
            # Windows rename refuses to overwrite an existing destination.
            # On POSIX use a hard link first to preserve that same guarantee.
            if os.name == 'nt':
                os.rename(path, target)
            else:
                os.link(path, target)
                path.unlink()
            committed = True
            record = read_record(target)
            update_entry(entry['id'], status='complete', afterStamp=record['stamp'])
            results.append({'path': str(path), 'newPath': str(target), 'backupId': entry['id'], 'record': record})
        except Exception as exc:
            if entry:
                with contextlib.suppress(Exception):
                    update_entry(entry['id'], status='committed' if committed else 'failed', error=str(exc), afterStamp=stamp(target) if committed else None)
            errors.append(error_item(item['path'], exc))
    return {'results': results, 'errors': errors}


def restore(identity):
    entries = get_history()
    entry = next((item for item in entries if item['id'] == identity), None)
    if not entry:
        raise EngineError('找不到备份记录', 'BACKUP_NOT_FOUND')
    if entry['status'] not in ('complete', 'committed', 'pending'):
        raise EngineError('此记录未完成，不能自动恢复', 'INCOMPLETE_BACKUP')
    if entry.get('restoredAt'):
        raise EngineError('此备份已恢复', 'ALREADY_RESTORED')
    source = Path(entry['backupPath'])
    # Only read backups located in this data directory, even if an index was edited.
    if source.resolve().parent != (DATA_DIR / 'backups').resolve():
        raise EngineError('备份路径不安全', 'INVALID_BACKUP')
    if stamp(source)['sha256'] != entry['beforeStamp']['sha256']:
        raise EngineError('备份文件校验失败', 'CORRUPT_BACKUP')
    path = Path(entry['path'])
    expected = entry.get('afterStamp')
    if not expected:
        raise EngineError('缺少写入后校验信息，不能安全恢复', 'INCOMPLETE_BACKUP')
    check_stamp(path, expected)
    if entry['action'] == 'rename':
        target = Path(entry['originalPath'])
        if target.exists() and os.path.normcase(str(target)) != os.path.normcase(str(path)):
            raise EngineError('原文件名已被占用，无法恢复', 'NAME_COLLISION')
        undo = create_backup(path, expected, 'rename', target=target, extra={'restoresId': identity, 'afterStamp': expected})
        try:
            check_stamp(path, expected)
            if os.name == 'nt':
                os.rename(path, target)
            else:
                os.link(path, target)
                path.unlink()
            record = read_record(target)
            update_entry(undo['id'], status='complete', afterStamp=record['stamp'])
        except Exception as exc:
            update_entry(undo['id'], status='failed', error=str(exc))
            raise
        result = {'path': str(target), 'backupId': undo['id'], 'record': record}
    else:
        result = replace_transaction(path, expected, restore_source=source, action='restore', extra={'restoresId': identity})
    update_entry(identity, restoredAt=datetime.datetime.now(datetime.timezone.utc).isoformat())
    result['previousPath'] = str(path)
    result['restoredId'] = identity
    return result


def export_sidecars(jobs, options):
    results, errors = [], []
    for job in jobs:
        try:
            path = canonical(job.get('path'))
            record = read_record(path)
            folder = canonical(options['directory']) if options.get('directory') else path.parent
            folder.mkdir(parents=True, exist_ok=True)
            exports = []
            if options.get('lyrics', True) and record['tags']['lyrics']:
                lyrics = record['tags']['lyrics']
                suffix = '.lrc' if re.search(r'\[\d{1,3}:\d{2}(?:\.\d+)?\]', lyrics) else '.txt'
                destination = folder / (path.stem + suffix)
                atomic_bytes(destination, lyrics.encode('utf-8'), overwrite=bool(options.get('overwrite')))
                exports.append(str(destination))
            if options.get('cover', True) and record['cover']:
                data, mime = parse_cover(record['cover'])
                suffix = {'image/jpeg': '.jpg', 'image/png': '.png', 'image/gif': '.gif', 'image/webp': '.webp'}.get(mime, '.img')
                destination = folder / (path.stem + suffix)
                atomic_bytes(destination, data, overwrite=bool(options.get('overwrite')))
                exports.append(str(destination))
            results.append({'path': str(path), 'files': exports})
        except Exception as exc:
            errors.append(error_item(job.get('path'), exc))
    return {'results': results, 'errors': errors}


def main(request):
    global DATA_DIR
    DATA_DIR = canonical(request['dataDir'])
    command = request['command']
    if command == 'read':
        return read_record(request['path'])
    if command == 'scan':
        return scan(request.get('paths', []))
    if command == 'history':
        return list(reversed(get_history()))
    if command == 'renamePreview':
        return rename_preview(request.get('jobs', []), request.get('pattern'))
    with mutation_lock():
        if command == 'writeBatch':
            return write_batch(request.get('jobs', []), request.get('options') or {})
        if command == 'renameBatch':
            return rename_batch(request.get('jobs', []), request.get('pattern'))
        if command == 'restore':
            return restore(request['id'])
        if command == 'exportSidecars':
            return export_sidecars(request.get('jobs', []), request.get('options') or {})
    raise EngineError('未知命令: ' + command, 'UNKNOWN_COMMAND')


if __name__ == '__main__':
    try:
        request = json.load(sys.stdin)
        result = main(request)
        response = {'ok': True, 'result': result}
    except Exception as exc:
        response = {'ok': False, 'error': error_item('', exc)}
    print(json.dumps(response, ensure_ascii=False, separators=(',', ':')))
