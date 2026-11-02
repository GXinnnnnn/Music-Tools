'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

class LyricExportError extends Error {
  constructor(code, message) { super(message); this.name = 'LyricExportError'; this.code = code; }
}
const fail = (code, message) => { throw new LyricExportError(code, message); };
const TIMESTAMP = /\[(?:(\d+):)?(\d+):([0-5]\d)(?:[.:](\d{1,3}))?\]/g;
const WORD_TIMESTAMP = /<(?:(?:\d+):)?\d+:[0-5]\d(?:[.:]\d{1,3})?>/g;
const METADATA = /^\s*(?:\[[a-z][a-z\d_-]*:[^\]]*\]\s*)+$/i;
const FORMATS = new Set(['srt', 'lrc', 'txt']);
const LAYOUTS = new Set(['bilingual', 'original', 'translation']);

function stringInput(value, name) {
  if (value == null) return '';
  if (typeof value !== 'string') fail('INVALID_LYRICS', `${name} 必须是文本。`);
  return value.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
}
function milliseconds(value, name, fallback = 0) {
  if (value == null) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isSafeInteger(Math.round(value))) fail('INVALID_OPTIONS', `${name} 必须是有效的毫秒数。`);
  return Math.round(value);
}
function timestampMs(match) {
  const [, hours, minutes, seconds, fraction = ''] = match;
  const value = ((Number(hours || 0) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000 + Number(fraction.padEnd(3, '0'));
  return Number.isSafeInteger(value) ? value : null;
}

/** Parse line LRC, preserving empty timed entries as end boundaries. Header offset is milliseconds, last header wins. */
function parseLrc(input = '') {
  input = stringInput(input, 'lyrics');
  const warnings = [];
  let offsetMs = 0;
  for (const match of input.matchAll(/\[offset:\s*([+-]?\d+)\s*\]/gi)) {
    if (Number.isSafeInteger(Number(match[1]))) offsetMs = Number(match[1]);
    else warnings.push('已忽略无效的 LRC 偏移设置。');
  }
  const events = [], plainLines = [];
  let order = 0;
  for (const rawLine of input.split('\n')) {
    const line = rawLine.trim();
    if (!line || METADATA.test(line)) continue;
    const stamps = [];
    // Only leading stamps are line timestamps; brackets in actual lyrics remain text.
    let rest = line;
    while (rest.startsWith('[')) {
      TIMESTAMP.lastIndex = 0;
      const match = TIMESTAMP.exec(rest);
      if (!match || match.index !== 0) break;
      const time = timestampMs(match);
      if (time !== null) stamps.push(time);
      else warnings.push('已忽略超出范围的 LRC 时间戳。');
      rest = rest.slice(match[0].length).trimStart();
    }
    const text = rest.replace(WORD_TIMESTAMP, '').trim();
    if (!stamps.length) {
      // Do not expose malformed timing directives as ordinary lyrics.
      if (/^\[[\d+-]/.test(line)) warnings.push('已忽略时间戳无效或不支持的歌词行。');
      else if (text) plainLines.push(text);
      continue;
    }
    for (const startMs of stamps) events.push({ startMs, text, order: order++ });
  }
  return { events, plainLines, offsetMs, warnings, timed: events.some(event => event.text) };
}
function normalizeFormat(format = 'srt') {
  if (typeof format !== 'string' || !FORMATS.has(format.toLowerCase())) fail('INVALID_FORMAT', '歌词格式必须为 SRT、LRC 或 TXT。');
  return format.toLowerCase();
}
function uniquePush(array, value) { if (value && !array.includes(value)) array.push(value); }
function srtTime(ms) {
  const hours = Math.floor(ms / 3600000);
  return `${String(hours).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
}
function lrcTime(ms) {
  return `[${String(Math.floor(ms / 60000)).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}]`;
}

/** duration is seconds, matching providers/local records; durationMs overrides it. Positive offsets delay lyrics. */
function convertLyrics(original, translated = '', options = {}) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) fail('INVALID_OPTIONS', '歌词转换设置无效。');
  const format = normalizeFormat(options.format);
  const layout = options.layout ?? 'bilingual';
  if (!LAYOUTS.has(layout)) fail('INVALID_OPTIONS', '请选择双语、原文或译文布局。');
  const bilingualMode = options.bilingualMode ?? 'lines';
  if (!['lines', 'inline', 'cues'].includes(bilingualMode)) fail('INVALID_OPTIONS', '请选择双行、同行或独立字幕条目的双语样式。');
  const separator = options.separator ?? ' / ';
  if (typeof separator !== 'string' || separator.length > 100 || /[\r\n]/.test(separator)) fail('INVALID_OPTIONS', '双语分隔符必须是 100 字以内的单行文本。');
  const offsetMs = milliseconds(options.offsetMs, 'offsetMs');
  const translationOffsetMs = milliseconds(options.translationOffsetMs, 'translationOffsetMs');
  let durationMs = null;
  if (options.durationMs != null) durationMs = milliseconds(options.durationMs, 'durationMs');
  else if (options.duration != null) {
    if (typeof options.duration !== 'number' || !Number.isFinite(options.duration)) fail('INVALID_OPTIONS', '歌曲时长必须是有效的秒数。');
    durationMs = milliseconds(options.duration * 1000, 'duration');
  }
  if (durationMs !== null && durationMs <= 0) fail('INVALID_OPTIONS', '歌曲时长必须大于零。');
  const sources = { original: parseLrc(original), translation: parseLrc(translated) };
  const warnings = [];
  const selected = layout === 'bilingual' ? ['original', 'translation'] : [layout];
  for (const key of selected) for (const warning of sources[key].warnings) uniquePush(warnings, warning);
  if (layout !== 'original' && !sources.translation.timed && !sources.translation.plainLines.length) warnings.push('此歌曲暂无译文。');
  const groups = new Map();
  let clipped = false;
  for (const key of selected) {
    const source = sources[key];
    const shift = source.offsetMs + offsetMs + (key === 'translation' ? translationOffsetMs : 0);
    if (!Number.isSafeInteger(shift)) fail('INVALID_OPTIONS', '合并后的歌词偏移超出范围。');
    if (source.plainLines.length && source.events.length) uniquePush(warnings, '已略过没有时间戳的歌词行。');
    for (const event of source.events) {
      let startMs = event.startMs + shift;
      if (!Number.isSafeInteger(startMs)) fail('INVALID_OPTIONS', '偏移后的歌词时间戳超出范围。');
      if (startMs < 0) { clipped = true; startMs = 0; }
      if (durationMs !== null && startMs >= durationMs) { uniquePush(warnings, '已略过超出歌曲时长的歌词。'); continue; }
      if (!groups.has(startMs)) groups.set(startMs, { startMs, original: [], translation: [] });
      uniquePush(groups.get(startMs)[key], event.text);
    }
  }
  if (clipped) warnings.push('小于零的歌词时间已调整为零。');
  const timeline = [...groups.values()].sort((a, b) => a.startMs - b.startMs);
  const cues = [];
  for (let i = 0; i < timeline.length; i++) {
    const event = timeline[i];
    const lines = [...event.original];
    for (const line of event.translation) uniquePush(lines, line);
    if (!lines.length) continue;
    let endMs = timeline[i + 1]?.startMs ?? durationMs;
    if (endMs == null) {
      // A final line without a duration or closing timestamp must not linger indefinitely.
      endMs = event.startMs + 3000;
      uniquePush(warnings, '歌曲时长未知，最后一句暂显示 3 秒。');
    }
    if (!Number.isSafeInteger(endMs)) fail('INVALID_OPTIONS', '字幕结束时间超出范围。');
    if (endMs > event.startMs) {
      if (layout === 'bilingual' && bilingualMode === 'cues') {
        for (const channel of ['original', 'translation']) {
          if (event[channel].length) cues.push({ ...event, endMs, channel, text: event[channel].join('\n') });
        }
        if (event.original.length && event.translation.length) uniquePush(warnings, '原文和译文以独立字幕条目导出，相同时间段会重叠显示。');
      } else cues.push({ ...event, endMs, text: lines.join(bilingualMode === 'inline' ? separator : '\n') });
    }
  }
  let text;
  if (format === 'txt') {
    const anyPlain = selected.some(key => sources[key].plainLines.length);
    if (anyPlain) {
      // Without timing correspondence, keep languages in separate blocks; do not pair by line index.
      const blocks = selected.map(key => {
        const source = sources[key];
        if (!source.events.length) return source.plainLines.join('\n');
        const lines = source.events.slice().sort((a, b) => a.startMs - b.startMs || a.order - b.order).filter(event => event.text).map(event => event.text);
        return [...lines, ...source.plainLines].join('\n');
      }).filter(Boolean);
      text = blocks.join('\n\n');
      if (selected.length > 1 && blocks.length > 1) uniquePush(warnings, '原文和译文没有对应时间，已分段导出。');
    } else text = cues.map(cue => cue.text).join('\n');
  } else {
    if (!cues.length) {
      const plain = selected.some(key => sources[key].plainLines.length);
      fail(plain ? 'UNSYNCED_LYRICS' : 'NO_LYRICS', plain ? '导出 SRT/LRC 需要时间戳；纯文本歌词请导出为 TXT。' : '当前布局没有可用的带时间戳歌词。');
    }
    for (const key of selected) if (sources[key].plainLines.length && !sources[key].timed) uniquePush(warnings, `已略过没有时间戳的${key === 'original' ? '原文' : '译文'}，无法自动生成时间。`);
    text = format === 'srt'
      ? cues.map((cue, index) => `${index + 1}\n${srtTime(cue.startMs)} --> ${srtTime(cue.endMs)}\n${cue.text}\n`).join('\n')
      : timeline.map(event => `${lrcTime(event.startMs)}${[...new Set([...event.original, ...event.translation])].join(bilingualMode === 'inline' ? separator : '\n' + lrcTime(event.startMs))}`).join('\n');
  }
  if (!text.trim()) fail('NO_LYRICS', '当前布局没有可用歌词。');
  // Windows subtitle editors expect CRLF; use the same encoding for every export format.
  text = text.replace(/\r\n?/g, '\n').replace(/\n/g, '\r\n');
  if (!text.endsWith('\r\n')) text += '\r\n';
  return { text, cues, warnings, format, layout, bilingualMode, timed: cues.length > 0, durationMs };
}

/** A single Windows-compatible stem, never a path. Reserved devices stay reserved with extensions too. */
function safeWindowsBasename(value) {
  if (typeof value !== 'string') fail('INVALID_FILENAME', '请输入有效的文件名。');
  let stem = value.normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g, '_').replace(/[ .]+$/g, '').trim();
  if (!stem || stem === '.' || stem === '..') stem = 'lyrics';
  if (/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])$/i.test(stem.split('.')[0].replace(/ +$/g, ''))) stem = '_' + stem;
  // Leave room for suffixes and extensions, and do not cut a Unicode surrogate pair.
  stem = Array.from(stem).reduce((result, char) => result.length + char.length <= 160 ? result + char : result, '').replace(/[ .]+$/g, '');
  return stem || 'lyrics';
}
/** Render a filename stem (without format extension); the suffix is applied after sanitization. */
function renderFilename({ audioPath, filenameTemplate = '{filename}', metadata = {}, suffix = '' } = {}) {
  if (typeof audioPath !== 'string' || !audioPath.trim() || /[\\/]$/.test(audioPath)) fail('INVALID_FILENAME', '请提供有效的音频文件名。');
  if (typeof filenameTemplate !== 'string' || !filenameTemplate.trim() || filenameTemplate.length > 1000) fail('INVALID_TEMPLATE', '文件名模板不能为空，且不能超过 1000 字。');
  const token = /\{(filename|title|artist|album|track|source)\}/g;
  if (/[{}]/.test(filenameTemplate.replace(token, ''))) fail('INVALID_TEMPLATE', '文件名模板含未知占位符，仅支持 filename、title、artist、album、track、source。');
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) fail('INVALID_TEMPLATE', '文件名元数据无效。');
  if (!['', '.original', '.translation'].includes(suffix)) fail('INVALID_FILENAME', '歌词文件后缀必须为空、.original 或 .translation。');
  const audioName = path.win32.basename(audioPath);
  const originalStem = audioName.slice(0, audioName.length - path.win32.extname(audioName).length);
  const fallbacks = { filename: originalStem, title: originalStem, artist: '未知艺术家', album: '未知专辑', track: '未知序号', source: '未知来源' };
  const rendered = filenameTemplate.replace(token, (_, key) => {
    if (key === 'filename') return originalStem;
    const value = metadata[key];
    if (value == null || String(value).trim() === '') return fallbacks[key];
    if (!['string', 'number'].includes(typeof value) || typeof value === 'number' && !Number.isFinite(value)) fail('INVALID_TEMPLATE', '文件名元数据必须是有效的文本或数字。');
    return String(value).trim();
  });
  return safeWindowsBasename(rendered) + suffix;
}

function aborted(signal) {
  if (signal?.aborted) throw new DOMException('歌词导出已取消。', 'AbortError');
}
const samePath = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const sameFile = (a, b) => a.dev === b.dev && a.ino === b.ino;
async function optionalLstat(filename) {
  try { return await fs.lstat(filename); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function checkedDirectory(directory, expected) {
  const absolute = path.resolve(directory);
  // Reject links/junctions in every ancestor, including the chosen output folder.
  const root = path.parse(absolute).root;
  let current = root;
  for (const part of absolute.slice(root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = await fs.lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) fail('UNSAFE_DIRECTORY', '导出目录及其上级目录不能是符号链接或目录联接。');
  }
  const real = await fs.realpath(absolute);
  if (!samePath(real, absolute)) fail('UNSAFE_DIRECTORY', '导出目录的实际位置与选择的路径不一致。');
  const stat = await fs.stat(absolute);
  if (expected && !sameFile(stat, expected)) fail('UNSAFE_DIRECTORY', '导出目录已发生变化，请重新选择。');
  return stat;
}
async function removeOwned(filename, identity) {
  const stat = await optionalLstat(filename);
  if (stat && !stat.isSymbolicLink() && sameFile(stat, identity)) await fs.unlink(filename);
}

/** Write UTF-8 beside the selected directory, never touch audio. Existing names get atomic exclusive numbered suffixes. */
async function saveLyric({ audioPath, directory, text, format = 'srt', overwrite = false, signal, filenameTemplate = '{filename}', metadata = {}, suffix = '' } = {}) {
  aborted(signal);
  format = normalizeFormat(format);
  if (typeof audioPath !== 'string' || !audioPath.trim() || /[\\/]$/.test(audioPath)) fail('INVALID_FILENAME', '请提供有效的音频文件名。');
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) fail('INVALID_DIRECTORY', '请选择有效的绝对路径作为导出目录。');
  if (typeof text !== 'string' || !text.trim()) fail('NO_LYRICS', '没有可导出的歌词文本。');
  if (typeof overwrite !== 'boolean') fail('INVALID_OPTIONS', '覆盖选项必须为布尔值。');
  const absolute = path.resolve(directory);
  const directoryStat = await checkedDirectory(absolute);
  const stem = renderFilename({ audioPath, filenameTemplate, metadata, suffix });
  const bytes = Buffer.byteLength(text, 'utf8');
  const audioAbsolute = path.resolve(audioPath);
  for (let index = 0; index < 10000; index++) {
    aborted(signal);
    const filename = `${stem}${index ? ` (${index})` : ''}.${format}`;
    const output = path.join(absolute, filename);
    if (samePath(output, audioAbsolute)) fail('AUDIO_PATH_CONFLICT', '歌词导出路径不能与音频文件相同。');
    await checkedDirectory(absolute, directoryStat);
    let handle;
    try { handle = await fs.open(output, 'wx', 0o600); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (!overwrite) continue;
      const existing = await fs.lstat(output);
      if (!existing.isFile() || existing.isSymbolicLink()) fail('UNSAFE_FILE', '不能覆盖链接、目录或其他非普通文件。');
      // Replace the directory entry with a newly written file, avoiding hard-link writes into audio.
      const temporary = path.join(absolute, `.lyric-${randomUUID()}.tmp`);
      let tempHandle, identity;
      try {
        tempHandle = await fs.open(temporary, 'wx', 0o600);
        identity = await tempHandle.stat();
        await tempHandle.writeFile(text, { encoding: 'utf8', signal });
        await tempHandle.close(); tempHandle = null;
        aborted(signal);
        await checkedDirectory(absolute, directoryStat);
        const latest = await fs.lstat(output);
        if (latest.isSymbolicLink() || !latest.isFile() || !sameFile(latest, existing)) fail('UNSAFE_FILE', '导出文件已发生变化，请重试。');
        await fs.rename(temporary, output);
        return { path: output, filename, format, bytes };
      } finally {
        if (tempHandle) await tempHandle.close();
        if (identity) await removeOwned(temporary, identity);
      }
    }
    const identity = await handle.stat();
    try {
      await checkedDirectory(absolute, directoryStat);
      aborted(signal);
      await handle.writeFile(text, { encoding: 'utf8', signal });
      aborted(signal);
      await handle.close(); handle = null;
      return { path: output, filename, format, bytes };
    } catch (error) {
      if (handle) { await handle.close(); handle = null; }
      await removeOwned(output, identity);
      throw error;
    } finally { if (handle) await handle.close(); }
  }
  fail('NAME_COLLISION_LIMIT', '重名文件过多，请更换导出目录或文件名。');
}

module.exports = { LyricExportError, parseLrc, convertLyrics, safeWindowsBasename, renderFilename, saveLyric, writeLyricFile: saveLyric };
