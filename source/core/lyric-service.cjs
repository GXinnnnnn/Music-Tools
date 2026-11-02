'use strict';

const providers = require('./providers.cjs');
const path = require('node:path');
const fs = require('node:fs/promises');
const { convertLyrics, saveLyric, renderFilename } = require('./lyric-export.cjs');
const SOURCES = Object.freeze(['qq', 'netease']);
const text = value => typeof value === 'string' ? value.trim() : '';
function sourceOptions(value = SOURCES) {
  if (!Array.isArray(value) || !value.length || value.some(id => !SOURCES.includes(id))) throw new Error('请选择 QQ 音乐或网易云音乐');
  return SOURCES.filter(id => value.includes(id));
}
function localInfo(record = {}) {
  const tags = record.tags || record;
  return { title: text(tags.title), artist: text(tags.artist), album: text(tags.album),
    duration: Number(record.duration ?? tags.duration) || null,
    filename: text(record.filename) || text(record.path).split(/[\\/]/).pop() || '' };
}
function candidateInfo(candidate) {
  const source = candidate?.source, id = text(candidate?.id);
  if (!SOURCES.includes(source) || !new RegExp(`^${source}:[A-Za-z0-9]{1,80}$`).test(id) || (source === 'netease' && !/^netease:\d+$/.test(id))) throw new Error('歌词候选无效，请重新搜索');
  const result = { id, source, duration: Number(candidate.duration) || null, score: Number(candidate.score) || 0 };
  for (const key of ['title', 'artist', 'album']) result[key] = text(candidate[key]).slice(0, 1000);
  if (!result.title) throw new Error('歌词候选缺少标题，请重新搜索');
  return result;
}
function conversionOptions(options = {}) {
  const bilingualMode = options.bilingualMode || 'lines';
  if (!['lines', 'inline', 'cues', 'separate'].includes(bilingualMode)) throw new Error('双语排列方式无效');
  return { format: options.format || 'srt', layout: options.layout || 'bilingual', bilingualMode,
    separator: typeof options.separator === 'string' ? options.separator.slice(0, 100) : ' / ',
    filenameTemplate: options.filenameTemplate || '{filename}', offsetMs: Number(options.offsetMs ?? 0),
    translationOffsetMs: Number(options.translationOffsetMs ?? 0), duration: Number(options.duration) || undefined };
}
function filenameMetadata(local = {}, candidate = {}) {
  const tags = local.tags || local;
  const result = {};
  for (const key of ['title', 'artist', 'album', 'track']) result[key] = text(tags[key]) || text(candidate[key]);
  result.source = text(candidate.source) || text(tags.source);
  return result;
}
function filenames(job) {
  const options = conversionOptions(job.options), metadata = job.metadata || {};
  if (!['srt', 'lrc', 'txt'].includes(options.format)) throw new Error('请选择 SRT、LRC 或 TXT 格式');
  const suffixes = options.layout === 'bilingual' && options.bilingualMode === 'separate' ? ['.original', '.translation'] : [''];
  return { filenames: suffixes.map(suffix => renderFilename({ audioPath: job.audioPath,
    filenameTemplate: options.filenameTemplate, metadata, suffix }) + '.' + options.format) };
}
function transport(options) {
  // Only allow known request controls; callers never choose a service URL or upload a local path.
  return { signal: options.signal, ...(options.fetch ? { fetch: options.fetch } : {}),
    timeoutMs: options.timeoutMs ?? 12000, retries: options.retries ?? 1,
    ...(options.throttleMs !== undefined ? { throttleMs: options.throttleMs } : {}),
    fields: ['lyrics'], artwork: false, lyrics: true, lyricsFallback: false };
}
async function search(query, options = {}) {
  const local = localInfo(options.local);
  const term = text(query) || providers.lookupQuery(local);
  const result = await providers.search(term, { ...transport(options), sources: sourceOptions(options.sources), local,
    limit: 30, autoFilename: options.autoFilename === true });
  return { ...result, candidates: result.candidates.filter(c => SOURCES.includes(c.source)).map(candidateInfo) };
}
async function fetchLyrics(candidate, options = {}) {
  candidate = candidateInfo(candidate);
  const result = await providers.enrich(candidate, transport(options));
  return { original: result.syncedLyrics || result.lyrics || result.plainLyrics || '', translated: result.translatedLyrics || '',
    instrumental: result.instrumental === true, source: candidate.source, errors: result.errors || [] };
}
function preview(data, options = {}) {
  if (typeof data?.original !== 'string' || typeof (data.translated ?? '') !== 'string' || data.original.length + (data.translated || '').length > 2 * 1024 * 1024) throw new Error('歌词文本无效或超过 2 MB');
  const selected = conversionOptions(options);
  if (selected.layout === 'bilingual' && selected.bilingualMode === 'separate') {
    const original = convertLyrics(data.original, data.translated || '', { ...selected, bilingualMode: 'lines', layout: 'original' });
    const translated = text(data.translated) ? convertLyrics(data.original, data.translated, { ...selected, bilingualMode: 'lines', layout: 'translation' }) : null;
    const files = [{ ...original, role: 'original', suffix: '.original' }, ...(translated ? [{ ...translated, role: 'translation', suffix: '.translation' }] : [])];
    return { ...original, bilingualMode: 'separate', files,
      text: files.map(file => `【${file.role === 'original' ? '原文文件' : '译文文件'}】\r\n${file.text}`).join('\r\n'),
      warnings: [...new Set(files.flatMap(file => file.warnings).concat(translated ? [] : ['来源没有译文，仅导出原文文件']))] };
  }
  return convertLyrics(data.original, data.translated || '', selected);
}
async function exportLyrics(job, options = {}) {
  options.signal?.throwIfAborted();
  const converted = preview(job, job.options), selected = conversionOptions(job.options);
  const files = [];
  try {
    for (const part of converted.files || [converted]) {
      options.signal?.throwIfAborted();
      files.push(await saveLyric({ audioPath: job.audioPath, directory: job.directory || path.dirname(job.audioPath), text: part.text,
        format: part.format, filenameTemplate: selected.filenameTemplate, metadata: job.metadata || {}, suffix: part.suffix || '',
        overwrite: false, signal: options.signal }));
    }
    options.signal?.throwIfAborted();
  } catch (error) {
    // All outputs were created exclusively by this request; failed groups leave no partial pair.
    const cleaned = await Promise.allSettled(files.map(file => fs.unlink(file.path)));
    if (cleaned.some(item => item.status === 'rejected')) error.message += '；部分已创建文件未能清理，请检查导出目录';
    throw error;
  }
  return { ...files[0], files, cues: (converted.files || [converted]).reduce((sum, part) => sum + part.cues.length, 0), warnings: converted.warnings };
}
const normArtist = value => text(value).normalize('NFKC').toLowerCase().replace(/[\p{P}\p{S}\s_]+/gu, '');
function recommended(local, candidates) {
  if (!candidates.length) return [];
  const top = candidates[0];
  if (!providers.isRecommendedCandidate(local, top)) return [];
  // A close alternative by a different performer requires a single-song review.
  if (candidates.slice(1).some(c => providers.isRecommendedCandidate(local, c)
    && normArtist(c.artist) !== normArtist(top.artist) && top.score - c.score < 8)) return [];
  return candidates.filter(c => normArtist(c.artist) === normArtist(top.artist) && providers.isRecommendedCandidate(local, c)).slice(0, 3);
}
async function batch(items, options = {}) {
  if (!Array.isArray(items) || !items.length || items.length > 20000) throw new Error('请选择要提取歌词的音频');
  sourceOptions(options.sources);
  const results = new Array(items.length), errors = [];
  let next = 0, done = 0;
  const notify = result => { done++; options.onProgress?.({ done, total: items.length, ...result }); };
  const worker = async () => {
    while (next < items.length && !options.signal?.aborted) {
      const index = next++, item = items[index];
      let row;
      try {
        const local = localInfo(item.local || item);
        const found = await search(providers.lookupQuery(local), { ...options, local, autoFilename: true });
        errors.push(...found.errors.map(e => ({ ...e, path: item.path })));
        const choices = recommended(local, found.candidates);
        if (!found.candidates.length) row = { path: item.path, status: 'no_match', message: '没有找到歌曲，请单曲检索或更换来源' };
        else if (!choices.length) row = { path: item.path, status: 'review', candidate: found.candidates[0], message: '版本或作者无法自动确认，请打开单曲校验' };
        else {
          let lastError;
          for (const candidate of choices) {
            options.signal?.throwIfAborted();
            try {
              const data = await fetchLyrics(candidate, options);
              errors.push(...data.errors.map(e => ({ ...e, path: item.path })));
              if (data.instrumental) { lastError = new Error('来源标记为纯音乐，没有可导出的歌词'); continue; }
              const saved = await exportLyrics({ audioPath: item.path, directory: options.directory, ...data,
                metadata: filenameMetadata(item.local || item, candidate),
                options: { ...options, duration: local.duration || candidate.duration } }, options);
              row = { path: item.path, status: 'exported', candidate, output: saved.path, outputs: saved.files.map(file => file.path), filename: saved.filename,
                warnings: saved.warnings, message: `已导出 ${saved.files.length > 1 ? saved.files.length + ' 个 ' : ''}${saved.format.toUpperCase()}` };
              break;
            } catch (e) { options.signal?.throwIfAborted(); lastError = e; }
          }
          if (!row) throw lastError || new Error('候选没有可导出的歌词');
        }
      } catch (error) {
        row = { path: item.path, status: options.signal?.aborted ? 'canceled' : 'error', message: options.signal?.aborted ? '已取消' : error.message };
      }
      results[index] = row;
      notify(row);
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, items.length) }, worker));
  for (let i = 0; i < items.length; i++) if (!results[i]) {
    results[i] = { path: items[i].path, status: 'canceled', message: '已取消，尚未处理' };
  }
  return { results, errors, canceled: options.signal?.aborted === true };
}
module.exports = { sourceOptions, localInfo, candidateInfo, conversionOptions, filenameMetadata, filenames, search, fetchLyrics, preview, exportLyrics, recommended, batch };
