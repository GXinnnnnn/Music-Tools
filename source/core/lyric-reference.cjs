'use strict';

// This module resolves identities only. It never runs page scripts or downloads lyrics.
const QQ_HOSTS = new Set(['y.qq.com', 'm.y.qq.com', 'c.y.qq.com', 'i.y.qq.com', 'music.qq.com', 'wx.music.qq.com']);
const NETEASE_HOSTS = new Set(['music.163.com', 'm.music.163.com', 'mobile.music.163.com', 'y.music.163.com', '163cn.tv', 'music.163.cn']);
const WRAPPER_KEYS = new Set(['url', 'target', 'targeturl', 'redirect', 'redirecturl', 'redirect_url', 'redirect_uri', 'redirecturi', 'jump', 'jumpurl', 'jump_url', 'link', 'linkurl', 'destination', 'dest', 'next', 'u']);
const DEFAULT_HOPS = 8;
const INPUT_LIMIT = 16384;

function failure(code, message) { return Object.assign(new Error(message), { code }); }
function selectedSource(value = 'auto') {
  const source = typeof value === 'string' ? value.toLowerCase().trim() : '';
  if (source === 'wy' || source === '163') return 'netease';
  if (['auto', 'qq', 'netease'].includes(source)) return source;
  throw failure('INVALID_SOURCE', '请选择 QQ 音乐或网易云音乐来源');
}
function numericId(value) {
  if (!/^\d{1,20}$/.test(value) || /^0+$/.test(value)) throw failure('INVALID_ID', '歌曲数字 ID 必须为不超过 20 位的正整数');
  return value.replace(/^0+(?=\d)/, '');
}
function qqId(value) {
  if (/^\d+$/.test(value)) return numericId(value);
  if (!/^[A-Za-z0-9]{8,80}$/.test(value) || !/\d/.test(value)) throw failure('INVALID_ID', 'QQ 歌曲 MID 必须为 8 至 80 位且包含数字的字母数字串');
  return value;
}
function result(source, value) {
  const id = source === 'qq' ? qqId(value) : numericId(value);
  const url = source === 'netease' ? `https://music.163.com/song?id=${id}`
    : /^\d+$/.test(id) ? `https://y.qq.com/portal/song.html?songid=${id}` : `https://y.qq.com/n/ryqq/songDetail/${id}`;
  return { source, id: `${source}:${id}`, url };
}
function entities(value) {
  return value.replace(/&(?:amp|quot|apos|lt|gt|#\d{1,7}|#x[\da-f]{1,6});/gi, entity => {
    const named = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>' }[entity.toLowerCase()];
    if (named) return named;
    const n = entity[2].toLowerCase() === 'x' ? parseInt(entity.slice(3, -1), 16) : parseInt(entity.slice(2, -1), 10);
    return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : entity;
  });
}
function decoded(value) {
  let text = entities(value).trim();
  for (let i = 0; i < 4 && /%[\da-f]{2}/i.test(text) && !/^(?:https?:)?\/\//i.test(text); i++) {
    try { const next = decodeURIComponent(text); if (next === text) break; text = next; } catch { break; }
  }
  return text;
}
function provider(url) {
  if (QQ_HOSTS.has(url.hostname) || /^c\d{1,2}\.y\.qq\.com$/.test(url.hostname)) return 'qq';
  if (NETEASE_HOSTS.has(url.hostname)) return 'netease';
  if (url.hostname === 'url.cn') return 'short';
  throw failure('UNTRUSTED_HOST', '仅支持 QQ 音乐和网易云音乐的官方歌曲链接');
}
function checkedURL(value, base) {
  const raw = decoded(value);
  if (!raw || /[\\\u0000-\u0020\u007f]/.test(raw)) throw failure('UNSAFE_URL', '歌曲链接包含无效或不安全的字符');
  let url;
  try { url = new URL(raw, base); } catch { throw failure('INVALID_REFERENCE', '歌曲链接格式无效'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port) throw failure('UNSAFE_URL', '歌曲链接必须使用标准 HTTP/HTTPS 地址，且不能包含登录信息或自定义端口');
  provider(url);
  return url;
}
function inputValue(input, source) {
  if (typeof input !== 'string' || !input.trim() || input.length > INPUT_LIMIT) throw failure('INVALID_REFERENCE', '请输入歌曲链接或歌曲 ID（最多 16384 字符）');
  const text = decoded(input);
  const prefixed = /^(qq|netease|wy|163)\s*:\s*([^\s]+)$/i.exec(text);
  if (prefixed) return { reference: result(selectedSource(prefixed[1]), prefixed[2], source) };
  if (/^\d+$/.test(text)) {
    numericId(text);
    if (source === 'auto') throw failure('SOURCE_REQUIRED', '纯数字歌曲 ID 无法判断来源，请选择 QQ 音乐或网易云音乐');
    return { reference: result(source, text, source) };
  }
  if (/^[A-Za-z0-9]+$/.test(text)) return { reference: result('qq', text, source) };
  if (/^[a-z][a-z\d+.-]*:/i.test(text) && !/^https?:\/\//i.test(text)) throw failure('UNSAFE_URL', '仅支持 HTTP/HTTPS 歌曲链接');
  const links = text.match(/https?:\/\/[^\s<>"'，。！？、【】（）《》]+/gi);
  if (links?.length) {
    const distinct = [...new Set(links.map(link => link.replace(/[.,;!?)}\]：；]+$/g, '')))];
    if (distinct.length > 1) throw failure('AMBIGUOUS_REFERENCE', '分享文本含有多个链接，请仅保留一个歌曲链接');
    // A URL input must be validated as a whole, not as a trusted substring of another URL.
    return { url: checkedURL(/^https?:\/\//i.test(text) && !/\s/.test(text) ? text.replace(/[，。！？、【】（）《》.,;!?)}\]：；]+$/g, '') : distinct[0]) };
  }
  if (/^[a-z][a-z\d+.-]*:/i.test(text)) throw failure('UNSAFE_URL', '仅支持 HTTP/HTTPS 歌曲链接');
  if (/^(?:[a-z\d-]+\.)+(?:com|cn|tv)(?:[/?#]|$)/i.test(text)) return { url: checkedURL(`https://${text}`) };
  throw failure('INVALID_REFERENCE', '无法识别歌曲链接或 ID，请粘贴官方歌曲分享链接');
}
function routeParts(url) {
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); } catch { throw failure('INVALID_REFERENCE', '歌曲链接路径编码无效'); }
  const parts = [{ pathname, params: url.searchParams }];
  const hash = url.hash.replace(/^#!?/, '');
  if (hash.startsWith('/')) {
    let route;
    try { route = new URL(hash, url.origin); } catch { throw failure('INVALID_REFERENCE', '歌曲链接片段无效'); }
    try { pathname = decodeURIComponent(route.pathname); } catch { throw failure('INVALID_REFERENCE', '歌曲链接路径编码无效'); }
    parts.unshift({ pathname, params: route.searchParams });
  }
  return parts;
}
function nonSong(part) {
  return /(?:^|\/)(?:album(?:detail)?|playlist|taoge|diss(?:detail)?|collect|artist|singer|radio|djradio|dj|program|mv)(?:[/.]|$)/i.test(part.pathname)
    || /^(?:album|playlist|artist|singer|mv|radio|dj)$/i.test(part.params.get('type') || '');
}
function queryValue(params, keys) {
  for (const key of keys) {
    const values = [...params].filter(([name]) => name.toLowerCase() === key).map(([, value]) => value);
    if (values.length) {
      if (new Set(values).size > 1) throw failure('AMBIGUOUS_REFERENCE', '歌曲链接包含互相冲突的 ID');
      return values[0];
    }
  }
  return null;
}
function inspectURL(url, source) {
  const kind = provider(url);
  const parts = routeParts(url);
  if (parts.some(nonSong)) throw failure('NOT_A_SONG', '该链接是专辑、歌单或其他页面，请使用单曲链接');
  for (const part of parts) {
    for (const [key, value] of part.params) {
      if (!WRAPPER_KEYS.has(key.toLowerCase())) continue;
      const target = decoded(value);
      if (/^(?:[a-z][a-z\d+.-]*:|\/|(?:[a-z\d-]+\.)+(?:com|cn|tv)[/?#])/i.test(target)) {
        return { next: checkedURL(/^(?:[a-z\d-]+\.)+(?:com|cn|tv)[/?#]/i.test(target) ? `https://${target}` : target, url) };
      }
    }
  }
  if (kind === 'short') return {};
  for (const { pathname, params } of parts) {
    if (kind === 'qq') {
      const pathId = /^\/(?:n\/(?:ryqq|yqq)\/)?(?:songDetail|song)\/([^/]+?)(?:\.html)?\/?$/i.exec(pathname);
      if (pathId) return { reference: result('qq', pathId[1], source) };
      const isSong = /\/(?:songDetail|song|playsong)(?:\.html)?\/?$/i.test(pathname) || /\/n\/m\/detail\/song\/index\.html$/i.test(pathname);
      const mid = queryValue(params, isSong ? ['songmid', 'mid'] : ['songmid']);
      if (mid !== null) return { reference: result('qq', mid, source) };
      const id = queryValue(params, isSong ? ['songid', 'musicid', 'id'] : ['songid', 'musicid']);
      if (id !== null) return { reference: result('qq', numericId(id), source) };
      if (isSong) throw failure('INVALID_ID', 'QQ 歌曲链接缺少有效的歌曲 MID 或数字 ID');
    } else {
      const song = /^\/(?:m\/)?song(?:\/([^/]+))?\/?$/i.exec(pathname);
      if (song) {
        const id = song[1] ?? queryValue(params, ['id', 'songid']);
        if (id === null) throw failure('INVALID_ID', '网易云歌曲链接缺少有效的数字 ID');
        return { reference: result('netease', id, source) };
      }
    }
  }
  return {};
}
function traversal(url, maxHops) {
  const seen = new Set([url.href]);
  let hops = 0;
  return { advance(next) {
    // url.cn is a general shortener: its next link must be an actual music provider.
    if (url.hostname === 'url.cn' && provider(next) === 'short') throw failure('UNTRUSTED_HOST', 'url.cn 短链必须直接指向官方音乐链接');
    if (seen.has(next.href)) throw failure('REDIRECT_LOOP', '歌曲分享链接存在循环跳转');
    if (++hops > maxHops) throw failure('TOO_MANY_REDIRECTS', '歌曲分享链接跳转次数过多');
    seen.add(next.href); url = next;
    return next;
  } };
}

/** Synchronously parse a direct ID, song URL or nested official URL wrapper.
 * source selects the provider of bare numeric IDs only; explicit identities win.
 * Returns { source: 'qq' | 'netease', id: '<source>:<id>', url: canonicalSongURL }.
 * Throws SOURCE_REQUIRED for bare numeric IDs in auto mode, and
 * REFERENCE_NEEDS_RESOLUTION for trusted links that require HTTP resolution.
 */
function parseReference(input, { source = 'auto' } = {}) {
  source = selectedSource(source);
  const parsed = inputValue(input, source);
  if (parsed.reference) return parsed.reference;
  let url = parsed.url;
  const walk = traversal(url, DEFAULT_HOPS);
  while (true) {
    const found = inspectURL(url, source);
    if (found.reference) return found.reference;
    if (!found.next) throw failure('REFERENCE_NEEDS_RESOLUTION', '歌曲分享链接需要联网解析');
    url = walk.advance(found.next);
  }
}
function integerOption(value, fallback, min, max, name) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value < min || value > max) throw failure('INVALID_OPTIONS', `${name} 必须为 ${min} 至 ${max} 的整数`);
  return value;
}
function abortReason(signal) { return signal.reason ?? new DOMException('已取消歌曲链接解析', 'AbortError'); }
function cancelBody(response) { try { Promise.resolve(response.body?.cancel()).catch(() => {}); } catch {} }
async function boundedBody(response, maxBytes, run) {
  const declared = response.headers?.get('content-length');
  if (declared && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
    cancelBody(response); throw failure('BODY_TOO_LARGE', '歌曲分享页面超过允许的大小');
  }
  if (!response.body) return '';
  if (typeof response.body.getReader !== 'function') throw failure('INVALID_RESPONSE', '歌曲分享页面必须提供有界可读数据流');
  const reader = response.body.getReader(), chunks = [];
  let length = 0, complete = false;
  try {
    while (true) {
      const { value, done } = await run(() => reader.read());
      if (done) { complete = true; break; }
      length += value.byteLength;
      if (length > maxBytes) throw failure('BODY_TOO_LARGE', '歌曲分享页面超过允许的大小');
      chunks.push(value);
    }
    return Buffer.concat(chunks, length).toString('utf8');
  } finally {
    if (!complete) { try { Promise.resolve(reader.cancel()).catch(() => {}); } catch {} }
    try { reader.releaseLock(); } catch {}
  }
}
function attributes(tag) {
  const attrs = new Map();
  for (const match of tag.matchAll(/([^\s=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) attrs.set(match[1].toLowerCase(), entities(match[2] ?? match[3] ?? match[4]));
  return attrs;
}
function jsString(literal) {
  return literal.slice(1, -1).replace(/\\(u[\da-f]{4}|x[\da-f]{2}|[\\/"'bfnrt])/gi, (_, escape) => {
    if (/^[ux]/i.test(escape)) return String.fromCharCode(parseInt(escape.slice(1), 16));
    return ({ b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' })[escape] ?? escape;
  });
}
function htmlTarget(html) {
  for (const match of html.matchAll(/<meta\b[^>]{0,4096}>/gi)) {
    const attrs = attributes(match[0]);
    if (attrs.get('http-equiv')?.toLowerCase() !== 'refresh') continue;
    const target = /(?:^|;)\s*url\s*=\s*(.+)\s*$/i.exec(attrs.get('content') || '');
    if (target) return target[1].trim().replace(/^(['"])([\s\S]*)\1$/, '$2');
  }
  // Recognize only literal location operations. No eval, DOM execution or script imports.
  const literal = String.raw`("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')`;
  const location = String.raw`(?:(?:window|document|top|self)\s*\.\s*)?location\s*`;
  const assignment = new RegExp(String.raw`\b${location}(?:\.\s*href\s*)?=\s*(?:decodeURIComponent\s*\(\s*)?${literal}`, 'gi');
  const call = new RegExp(String.raw`\b${location}\.\s*(?:replace|assign)\s*\(\s*(?:decodeURIComponent\s*\(\s*)?${literal}`, 'gi');
  for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)) {
    const match = assignment.exec(script[1]) || call.exec(script[1]);
    assignment.lastIndex = 0; call.lastIndex = 0;
    if (match) return jsString(match[1]);
  }
  return null;
}

/** Resolve an ID/link/share text with manual HTTP redirects and static HTML wrappers.
 * Options: source, fetch, signal, timeoutMs (12000, 1..60000),
 * maxHops (8, 0..16), maxBodyBytes (131072, 1..1048576).
 * timeoutMs covers the whole operation, including streaming response bodies.
 */
async function resolveReference(input, options = {}) {
  const source = selectedSource(options.source);
  const maxHops = integerOption(options.maxHops, DEFAULT_HOPS, 0, 16, 'maxHops');
  const maxBodyBytes = integerOption(options.maxBodyBytes, 128 * 1024, 1, 1024 * 1024, 'maxBodyBytes');
  const timeoutMs = integerOption(options.timeoutMs, 12000, 1, 60000, 'timeoutMs');
  const signal = options.signal;
  if (signal && (typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) throw failure('INVALID_OPTIONS', 'signal 必须为 AbortSignal');
  if (signal?.aborted) throw abortReason(signal);
  const parsed = inputValue(input, source);
  if (parsed.reference) return parsed.reference;
  const fetcher = options.fetch ?? globalThis.fetch;
  if (typeof fetcher !== 'function') throw failure('INVALID_OPTIONS', '需要可用的 fetch 才能解析分享链接');
  const controller = new AbortController();
  const aborted = new Promise((_, reject) => controller.signal.addEventListener('abort', () => reject(abortReason(controller.signal)), { once: true }));
  // Register before scheduling work, including with injected fetch implementations.
  aborted.catch(() => {});
  const cancel = () => controller.abort(abortReason(signal));
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(Object.assign(failure('TIMEOUT', '歌曲分享链接解析超时，请重试'), { name: 'TimeoutError' })), timeoutMs);
  const run = operation => {
    if (controller.signal.aborted) return Promise.reject(abortReason(controller.signal));
    return Promise.race([Promise.resolve().then(operation), aborted]);
  };
  let url = parsed.url;
  const walk = traversal(url, maxHops);
  try {
    while (true) {
      if (controller.signal.aborted) throw abortReason(controller.signal);
      const found = inspectURL(url, source);
      if (found.reference) return found.reference;
      if (found.next) { url = walk.advance(found.next); continue; }
      const requestURL = new URL(url); requestURL.hash = '';
      const response = await run(async () => {
        const incoming = await fetcher(requestURL.href, { method: 'GET', redirect: 'manual', signal: controller.signal,
          credentials: 'omit', referrerPolicy: 'no-referrer', headers: { Accept: 'text/html,application/xhtml+xml' } });
        if (controller.signal.aborted) { cancelBody(incoming); throw abortReason(controller.signal); }
        return incoming;
      });
      if (!response || !Number.isInteger(response.status)) throw failure('INVALID_RESPONSE', '歌曲分享链接返回了无效响应');
      if (response.redirected || (response.url && response.url !== requestURL.href)) {
        cancelBody(response); throw failure('UNEXPECTED_REDIRECT', '歌曲分享链接发生了未经检查的自动跳转');
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        cancelBody(response);
        const location = response.headers?.get('location');
        if (!location) throw failure('INVALID_REDIRECT', '歌曲分享链接的跳转地址为空');
        url = walk.advance(checkedURL(location, url));
        continue;
      }
      if (response.status < 200 || response.status >= 300) {
        cancelBody(response); throw failure('HTTP_ERROR', `歌曲分享链接请求失败（HTTP ${response.status}）`);
      }
      const html = await boundedBody(response, maxBodyBytes, run);
      const target = htmlTarget(html);
      if (!target) throw failure('NOT_A_SONG', '分享页面中没有找到可识别的歌曲链接，请粘贴单曲链接或 ID');
      url = walk.advance(checkedURL(target, url));
    }
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    // Release pending network/body work on errors, even if a custom fetch ignores abort.
    controller.abort();
  }
}

module.exports = { parseReference, resolveReference };
