'use strict';
// Resolve metadata only at fixed public song-detail endpoints; never fetch audio.
const names = { qq: 'QQ 音乐', netease: '网易云音乐' };
const clean = value => typeof value === 'string' ? value.trim().slice(0, 1000) : '';
const decode = value => clean(value).replace(/&(?:amp|quot|apos|lt|gt);/g, x => ({'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>'})[x]);
async function songInfo(reference, options = {}) {
  const { source, id } = reference, key = id.slice(source.length + 1);
  const fallback = { source, id, title: `${names[source]} ${key}`, artist: '', album: '', duration: null };
  const timeout = AbortSignal.timeout(Math.max(100, Math.min(30000, Number(options.timeoutMs) || 10000)));
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const url = source === 'netease'
    ? `https://music.163.com/api/song/detail/?${new URLSearchParams({ ids: JSON.stringify([key]) })}`
    : `https://c.y.qq.com/v8/fcg-bin/fcg_play_single_song.fcg?${new URLSearchParams({ [/^\d+$/.test(key) ? 'songid' : 'songmid']: key, tpl: 'yqq_song_detail', format: 'json' })}`;
  try {
    const response = await (options.fetch || globalThis.fetch)(url, { signal, redirect: 'error', headers: { 'User-Agent': 'Mozilla/5.0 MusicTools', Referer: source === 'qq' ? 'https://y.qq.com/' : 'https://music.163.com/', Accept: 'application/json' } });
    if (!response.ok) throw new Error(`歌曲信息服务返回 HTTP ${response.status}`);
    // Bound the response even when Content-Length is absent or incorrect.
    const reader = response.body?.getReader();
    if (!reader) throw new Error('歌曲信息响应为空');
    const chunks = []; let length = 0;
    try {
      while (true) {
        signal.throwIfAborted();
        const { value, done } = await reader.read(); if (done) break;
        length += value.length; if (length > 1024 * 1024) throw new Error('歌曲信息响应过大');
        chunks.push(Buffer.from(value));
      }
    } finally { await reader.cancel().catch(() => {}); }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const song = source === 'netease' ? data.songs?.[0] : data.data?.[0];
    if (!song || !clean(song.name || song.title)) throw new Error('未取得歌曲名称，暂以歌曲 ID 命名');
    // Do not accept a detail response for another recording.
    if (source === 'netease' && String(song.id) !== key || source === 'qq' && String(/^\d+$/.test(key) ? song.id : song.mid) !== key) throw new Error('歌曲信息的 ID 与输入不一致');
    return { candidate: { ...fallback, title: decode(song.name || song.title), artist: (song.artists || song.ar || song.singer || []).map(x => decode(x.name)).filter(Boolean).join(' / '), album: decode((song.album || song.al)?.name), duration: Number(source === 'netease' ? (song.duration ?? song.dt) / 1000 : song.interval) || null }, errors: [] };
  } catch (error) {
    options.signal?.throwIfAborted();
    return { candidate: fallback, errors: [{ source, message: `歌曲信息未取得，将使用歌曲 ID 命名。${timeout.aborted ? '请求超时，请稍后重试。' : error.message}` }] };
  }
}
module.exports = { songInfo };
