'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseReference, resolveReference } = require('../source/core/lyric-reference.cjs');
const MID = '0039MnYb0qxYhV';
const qqURL = `https://y.qq.com/n/ryqq/songDetail/${MID}`;
const neteaseURL = 'https://music.163.com/song?id=347230';
const qq = { source: 'qq', id: `qq:${MID}`, url: qqURL };
const netease = { source: 'netease', id: 'netease:347230', url: neteaseURL };
const code = expected => error => error?.code === expected;
const redirect = (location, status = 302) => new Response(null, { status, headers: { location } });
function mockFetch(steps) {
  const calls = [];
  const fetch = async (url, options) => {
    calls.push({ url, options });
    assert.equal(options.redirect, 'manual');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.referrerPolicy, 'no-referrer');
    assert.equal(options.method, 'GET');
    assert.ok(options.signal instanceof AbortSignal);
    assert.ok(calls.length <= steps.length, `Unexpected request: ${url}`);
    const step = steps[calls.length - 1];
    if (step.url) assert.equal(url, step.url);
    return typeof step.response === 'function' ? step.response() : step.response;
  };
  return { fetch, calls };
}

test('prefixed IDs, source aliases, raw MIDs, numeric source selection and canonical prefixed output', () => {
  assert.deepEqual(parseReference(`qq:${MID}`), qq);
  assert.deepEqual(parseReference(MID), qq);
  assert.deepEqual(parseReference(`  ${MID}  `, { source: 'QQ' }), qq);
  for (const prefix of ['netease', 'wy', '163']) assert.deepEqual(parseReference(`${prefix}:347230`), netease);
  for (const source of ['netease', 'wy', '163']) assert.deepEqual(parseReference('347230', { source }), netease);
  assert.deepEqual(parseReference('347230', { source: 'qq' }), { source: 'qq', id: 'qq:347230', url: 'https://y.qq.com/portal/song.html?songid=347230' });
  assert.equal(parseReference('netease:000347230').id, 'netease:347230');
  assert.throws(() => parseReference('347230'), code('SOURCE_REQUIRED'));
  assert.deepEqual(parseReference(MID, { source: 'netease' }), qq);
  assert.deepEqual(parseReference('netease:347230', { source: 'qq' }), netease);
  assert.deepEqual(parseReference(`qq:${MID}`, { source: 'netease' }), qq);
  assert.deepEqual(parseReference(qqURL, { source: 'netease' }), qq);
  assert.throws(() => parseReference(MID, { source: 'other' }), code('INVALID_SOURCE'));
});

test('QQ desktop/mobile real song link variants and provider hosts', () => {
  const urls = [
    qqURL, `https://y.qq.com/n/yqq/song/${MID}.html`, `http://y.qq.com/n/yqq/song/${MID}.html`,
    `https://y.qq.com/portal/song.html?songmid=${MID}`, `https://y.qq.com/portal/song.html?mid=${MID}`, `https://m.y.qq.com/n/ryqq/songDetail/${MID}?ADTAG=share`,
    `https://m.y.qq.com/n/ryqq/songDetail?songmid=${MID}`, `https://i.y.qq.com/v8/playsong.html?songmid=${MID}`,
    `https://c.y.qq.com/v8/playsong.html?songmid=${MID}&from=singlemessage`,
    `https://i.y.qq.com/n2/m/share/details/index.html?songmid=${MID}&ADTAG=myqq`,
    `https://wx.music.qq.com/song?songmid=${MID}`, `https://music.qq.com/portal/song.html?songmid=${MID}`,
    `https://y.qq.com/song?id=347230&songmid=${MID}`, `y.qq.com/n/ryqq/songDetail/${MID}`,
    `https://y.qq.com:443/n/ryqq/songDetail/${MID}`,
  ];
  for (const url of urls) assert.deepEqual(parseReference(url), qq, url);
  const numeric = [
    'https://y.qq.com/portal/song.html?songid=347230', 'https://y.qq.com/portal/song.html?musicid=347230',
    'https://y.qq.com/portal/song.html?id=347230', 'https://m.y.qq.com/n/m/detail/song/index.html?songid=347230',
    'https://i.y.qq.com/v8/playsong.html?songid=347230', 'https://y.qq.com/song?id=347230',
    'https://y.qq.com/song/347230',
  ];
  for (const url of numeric) assert.equal(parseReference(url).id, 'qq:347230', url);
});

test('NetEase desktop/mobile/hash song links and provider hosts', () => {
  const urls = [
    neteaseURL, 'http://music.163.com/song?id=347230&userid=1', 'https://music.163.com/#/song?id=347230',
    'https://music.163.com/#/song?id=347230&uct2=hello', 'https://music.163.com/#!/song?id=347230',
    'https://music.163.com/song/347230', 'https://m.music.163.com/m/song/347230',
    'https://music.163.com/m/song/347230', 'https://m.music.163.com/m/song?id=347230',
    'https://mobile.music.163.com/song?id=347230', 'https://y.music.163.com/m/song?id=347230&app_version=9',
    'https://music.163.cn/song?id=347230', 'https://163cn.tv/song?id=347230',
    'https://music.163.com/#/m/song/347230', 'music.163.com/song?id=347230',
  ];
  for (const url of urls) assert.deepEqual(parseReference(url), netease, url);
});

test('pasted share text, HTML entities and multiply percent encoded URL wrappers', () => {
  assert.deepEqual(parseReference(`分享周杰伦的歌曲《歌名》：${qqURL} (来自QQ音乐)`), qq);
  assert.deepEqual(parseReference(`分享歌曲 ${neteaseURL}，快来听听！`), netease);
  assert.deepEqual(parseReference(`《歌名》【${qqURL}】`), qq);
  assert.deepEqual(parseReference(encodeURIComponent(encodeURIComponent(qqURL))), qq);
  assert.deepEqual(parseReference(`https://y.qq.com/portal/song.html?from=share&amp;songmid=${MID}`), qq);
  for (const key of ['url', 'target', 'redirectUrl', 'redirect_url', 'redirect_uri', 'jumpUrl', 'link', 'next']) {
    assert.deepEqual(parseReference(`https://c.y.qq.com/base/fcgi-bin/u?${key}=${encodeURIComponent(encodeURIComponent(qqURL))}`), qq, key);
  }
  const wrapped = `https://music.163.cn/api/jump?target=${encodeURIComponent(neteaseURL)}`;
  assert.deepEqual(parseReference(`https://163cn.tv/AbCd?url=${encodeURIComponent(wrapped)}`), netease);
  assert.deepEqual(parseReference(`https://url.cn/abc123?url=${encodeURIComponent(qqURL)}`), qq);
  assert.throws(() => parseReference(`${qqURL} ${neteaseURL}`), code('AMBIGUOUS_REFERENCE'));
});

test('validates positive numeric lengths and sensible QQ MIDs without guessing', () => {
  assert.equal(parseReference('netease:12345678901234567890').id, 'netease:12345678901234567890');
  assert.equal(parseReference('qq:12345678901234567890').id, 'qq:12345678901234567890');
  for (const value of ['netease:0', 'netease:000', 'netease:-1', 'netease:1.5', 'netease:1e3', 'netease:123456789012345678901',
    'qq:0', 'qq:123456789012345678901', 'qq:abcdefg1'.slice(0, -1), 'qq:abcdefgh', 'qq:abc_123456', `qq:${'a'.repeat(80)}1`]) {
    assert.throws(() => parseReference(value), code('INVALID_ID'), value);
  }
  for (const input of ['', ' ', null, 347230, {}, 'x'.repeat(16385)]) assert.throws(() => parseReference(input), code('INVALID_REFERENCE'));
  for (const url of ['https://music.163.com/song?id=0', 'https://music.163.com/song?id=-1', 'https://music.163.com/song?id=1e9',
    'https://music.163.com/song?id=123456789012345678901', 'https://y.qq.com/portal/song.html?songmid=abcdefg',
    'https://y.qq.com/song?id=notasong', 'https://music.163.com/song']) assert.throws(() => parseReference(url), code('INVALID_ID'), url);
  assert.throws(() => parseReference('https://music.163.com/song?id=123&id=456'), code('AMBIGUOUS_REFERENCE'));
});

test('albums, playlists and other non-song routes never become song IDs', async () => {
  const urls = [
    'https://music.163.com/album?id=347230', 'https://music.163.com/#/playlist?id=347230',
    'https://music.163.com/m/artist/347230', 'https://music.163.com/#/djradio?id=347230',
    `https://y.qq.com/n/ryqq/albumDetail/${MID}`, `https://y.qq.com/portal/playlist.html?id=347230&songmid=${MID}`,
    'https://y.qq.com/n/ryqq/playlist/347230', `https://i.y.qq.com/v8/playsong.html?type=album&songmid=${MID}`,
    `https://y.qq.com/n/ryqq/singer/${MID}?songid=347230`,
  ];
  for (const url of urls) {
    assert.throws(() => parseReference(url), code('NOT_A_SONG'), url);
    await assert.rejects(resolveReference(url, { fetch: () => assert.fail('No request for a non-song URL') }), code('NOT_A_SONG'), url);
  }
  assert.throws(() => parseReference('https://music.163.com/?id=347230'), code('REFERENCE_NEEDS_RESOLUTION'));
  assert.throws(() => parseReference('https://y.qq.com/?id=347230'), code('REFERENCE_NEEDS_RESOLUTION'));
});

test('untrusted hosts, credentials, ports, private targets and dangerous protocols are rejected', async () => {
  const urls = [
    'https://example.com/song?id=123', 'https://y.qq.com.evil.test/song?id=123', 'https://evil-y.qq.com/song?id=123',
    'https://music.163.com.evil.test/song?id=123', 'https://127.0.0.1/song?id=123', 'http://localhost/song?id=123',
    'http://169.254.169.254/latest/meta-data', 'https://[::1]/song?id=123', 'file:///etc/passwd', 'javascript:alert(1)',
    'data:text/html,anything', 'https://user:pass@y.qq.com/song?id=123', 'https://y.qq.com:444/song?id=123',
    'https://y.qq.com@evil.test/song?id=123', 'https://y.qq.com./song?id=123', 'https://y.qq.com\\@evil.test/song?id=123',
    'https://example.com/?url=https://music.163.com/song?id=123',
  ];
  for (const url of urls) {
    assert.throws(() => parseReference(url), undefined, url);
    let calls = 0;
    await assert.rejects(resolveReference(url, { fetch: () => { calls++; assert.fail('Unsafe URL reached fetch'); } }), undefined, url);
    assert.equal(calls, 0, url);
  }
  for (const target of ['http://127.0.0.1/', 'https://evil.test/song?id=123', 'file:///etc/passwd', 'javascript:alert(1)', '//169.254.169.254/']) {
    const url = `https://y.qq.com/share?url=${encodeURIComponent(target)}`;
    assert.throws(() => parseReference(url), undefined, target);
    await assert.rejects(resolveReference(url, { fetch: () => assert.fail('Unsafe wrapper reached fetch') }), undefined, target);
  }
});

test('synchronous short links request async resolution; direct async references never fetch', async () => {
  for (const url of ['https://url.cn/abc123', 'https://c.y.qq.com/base/fcgi-bin/u?__=abc', 'https://163cn.tv/abc123', 'https://music.163.cn/api/jump/abc']) {
    assert.throws(() => parseReference(url), code('REFERENCE_NEEDS_RESOLUTION'), url);
  }
  for (const input of [MID, qqURL, `qq:${MID}`]) {
    assert.deepEqual(await resolveReference(input, { fetch: () => assert.fail('Direct references must not fetch') }), qq);
  }
});

test('manual HTTP redirects resolve relative locations, known music shorteners and nested wrappers', async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    const mock = mockFetch([{ url: 'https://url.cn/abc123', response: redirect(qqURL, status) }]);
    assert.deepEqual(await resolveReference('https://url.cn/abc123', { fetch: mock.fetch }), qq);
    assert.equal(mock.calls.length, 1);
  }
  const mock = mockFetch([
    { url: 'https://163cn.tv/abc', response: redirect('https://music.163.cn/api/jump/abc') },
    { url: 'https://music.163.cn/api/jump/abc', response: redirect('/api/jump/next', 307) },
    { url: 'https://music.163.cn/api/jump/next', response: redirect(`https://y.music.163.com/share?target=${encodeURIComponent(neteaseURL)}`, 308) },
  ]);
  assert.deepEqual(await resolveReference('https://163cn.tv/abc', { fetch: mock.fetch }), netease);
  assert.equal(mock.calls.length, 3);
});

test('numbered QQ music short hosts resolve through the same strict manual-hop policy', async () => {
  const start = 'https://c6.y.qq.com/base/fcgi-bin/u?__=real-share';
  assert.throws(() => parseReference(start), code('REFERENCE_NEEDS_RESOLUTION'));
  const mock = mockFetch([
    { url: start, response: redirect('https://c13.y.qq.com/share') },
    { url: 'https://c13.y.qq.com/share', response: redirect(qqURL) },
  ]);
  assert.deepEqual(await resolveReference(start, { fetch: mock.fetch }), qq);
  for (const host of ['c123.y.qq.com', 'c6.y.qq.com.evil.test', 'c6-y.qq.com']) {
    await assert.rejects(resolveReference(`https://${host}/share`, { fetch: () => assert.fail('Untrusted numbered alias reached fetch') }), code('UNTRUSTED_HOST'));
  }
});

test('static HTML meta refresh supports case, attribute order, quoting, entities and relative targets', async () => {
  for (const html of [
    `<meta http-equiv="refresh" content="0; url=${qqURL}">`,
    `<META CONTENT='0; URL="${qqURL}"' HTTP-EQUIV=Refresh>`,
    `<meta content="0;url=/portal/song.html?from=share&amp;songmid=${MID}" http-equiv="refresh">`,
    `<meta http-equiv=refresh content='0; url=${qqURL.replace('https:', '')}'>`,
  ]) {
    const mock = mockFetch([{ response: new Response(html) }]);
    assert.deepEqual(await resolveReference('https://c.y.qq.com/share', { fetch: mock.fetch }), qq, html);
  }
});

test('static JS location literals support assign/replace/href and safe escape decoding without execution', async () => {
  const expressions = [
    `window.location.href = '${qqURL}'`, `location = "${qqURL}"`, `document.location = '${qqURL}'`,
    `location.replace('${qqURL}')`, `window.location.assign("${qqURL}")`, `self.location.href = '${qqURL}'`,
    `top.location.href = '${qqURL}'`, `window.location.href = '${qqURL.replace(/\//g, '\\/')}'`,
    `window.location.href = 'https:\\u002f\\u002fy.qq.com\\u002fn\\u002fryqq\\u002fsongDetail\\u002f${MID}'`,
    `location.href = decodeURIComponent('${encodeURIComponent(qqURL)}')`,
  ];
  for (const expression of expressions) {
    const mock = mockFetch([{ response: new Response(`<html><script>throw new Error('must never execute'); ${expression}; globalThis.__lyricReferenceExecuted = true;</script></html>`) }]);
    assert.deepEqual(await resolveReference('https://c.y.qq.com/share', { fetch: mock.fetch }), qq, expression);
    assert.equal(globalThis.__lyricReferenceExecuted, undefined);
  }
});

test('mixed redirect/meta/script chain is bounded and validates every transition', async () => {
  const mock = mockFetch([
    { url: 'https://url.cn/a', response: redirect('https://c.y.qq.com/share') },
    { url: 'https://c.y.qq.com/share', response: new Response('<meta http-equiv="refresh" content="0;url=/next">') },
    { url: 'https://c.y.qq.com/next', response: new Response(`<script>location.replace('${qqURL}')</script>`) },
  ]);
  assert.deepEqual(await resolveReference('https://url.cn/a', { fetch: mock.fetch, maxHops: 3 }), qq);
  assert.equal(mock.calls.length, 3);
  const limited = mockFetch([
    { response: redirect('https://c.y.qq.com/share') },
    { response: new Response(`<script>location.href='${qqURL}'</script>`) },
  ]);
  await assert.rejects(resolveReference('https://url.cn/a', { fetch: limited.fetch, maxHops: 1 }), code('TOO_MANY_REDIRECTS'));
});

test('unsafe HTTP, meta and script redirects never issue the dangerous second request', async () => {
  for (const target of ['http://127.0.0.1/', 'http://169.254.169.254/latest/meta-data', 'https://evil.test/',
    'https://y.qq.com.evil.test/song?id=123', '//localhost/', 'file:///etc/passwd', 'javascript:alert(1)',
    'https://user:pass@y.qq.com/song?id=123', 'https://y.qq.com:8080/song?id=123']) {
    for (const response of [redirect(target), new Response(`<meta http-equiv="refresh" content="0;url=${target}">`), new Response(`<script>location.href='${target}'</script>`)]) {
      const mock = mockFetch([{ response }]);
      await assert.rejects(resolveReference('https://c.y.qq.com/share', { fetch: mock.fetch }), undefined, target);
      assert.equal(mock.calls.length, 1);
    }
  }
  const mock = mockFetch([{ response: redirect('https://url.cn/b') }]);
  await assert.rejects(resolveReference('https://url.cn/a', { fetch: mock.fetch }), code('UNTRUSTED_HOST'));
});

test('redirect loops, query-wrapper loops and hop exhaustion have stable errors', async () => {
  const loop = mockFetch([{ response: redirect('/a') }]);
  await assert.rejects(resolveReference('https://c.y.qq.com/a', { fetch: loop.fetch }), code('REDIRECT_LOOP'));
  const cycle = mockFetch([{ response: redirect('/b') }, { response: new Response('<script>location.href="/a"</script>') }]);
  await assert.rejects(resolveReference('https://c.y.qq.com/a', { fetch: cycle.fetch }), code('REDIRECT_LOOP'));
  let calls = 0;
  await assert.rejects(resolveReference('https://c.y.qq.com/a0', { maxHops: 2, fetch: async () => redirect(`/a${++calls}`) }), code('TOO_MANY_REDIRECTS'));
  assert.equal(calls, 3);
  let wrapped = qqURL;
  for (let i = 0; i < 10; i++) wrapped = `https://y.qq.com/w${i}?url=${encodeURIComponent(wrapped)}`;
  assert.throws(() => parseReference(wrapped), code('TOO_MANY_REDIRECTS'));
  await assert.rejects(resolveReference(`https://c.y.qq.com/share?url=${encodeURIComponent(qqURL)}`, { maxHops: 0 }), code('TOO_MANY_REDIRECTS'));
});

test('provider identity from links and redirects overrides the bare-ID source dropdown', async () => {
  let calls = 0;
  assert.deepEqual(await resolveReference(neteaseURL, { source: 'qq', fetch: () => { calls++; } }), netease);
  assert.equal(calls, 0);
  const mock = mockFetch([{ response: redirect(neteaseURL) }]);
  assert.deepEqual(await resolveReference('https://url.cn/a', { source: 'qq', fetch: mock.fetch }), netease);
  assert.equal(mock.calls.length, 1);
});

test('bounded HTML bodies reject declared oversize and streaming overflow, cancelling readers', async () => {
  let canceled = 0;
  const oversized = new Response(new ReadableStream({ cancel() { canceled++; } }), { headers: { 'content-length': '10000' } });
  await assert.rejects(resolveReference('https://c.y.qq.com/share', { fetch: async () => oversized, maxBodyBytes: 100 }), code('BODY_TOO_LARGE'));
  assert.equal(canceled, 1);
  const stream = new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(80)); }, cancel() { canceled++; } });
  await assert.rejects(resolveReference('https://c.y.qq.com/share', { fetch: async () => new Response(stream), maxBodyBytes: 100 }), code('BODY_TOO_LARGE'));
  assert.equal(canceled, 2);
});

test('pre-cancellation, cancellation in fetch and cancellation while streaming are observed promptly', async () => {
  const before = new AbortController(); before.abort();
  await assert.rejects(resolveReference(qqURL, { signal: before.signal }), error => error.name === 'AbortError');
  const during = new AbortController();
  let networkSignal;
  const waiting = resolveReference('https://c.y.qq.com/share', { signal: during.signal, fetch: async (_, options) => {
    networkSignal = options.signal; during.abort(); return new Promise(() => {});
  } });
  await assert.rejects(waiting, error => error.name === 'AbortError');
  assert.equal(networkSignal.aborted, true);
  const bodyAbort = new AbortController();
  let canceled = false;
  const stream = new ReadableStream({ pull() { bodyAbort.abort(); return new Promise(() => {}); }, cancel() { canceled = true; } });
  await assert.rejects(resolveReference('https://c.y.qq.com/share', { signal: bodyAbort.signal, fetch: async () => new Response(stream) }), error => error.name === 'AbortError');
  assert.equal(canceled, true);
});

test('overall timeout covers a fetch or response stream that never settles, even if fetch ignores abort', async () => {
  let signal;
  await assert.rejects(resolveReference('https://c.y.qq.com/share', { timeoutMs: 20, fetch: async (_, options) => { signal = options.signal; return new Promise(() => {}); } }), code('TIMEOUT'));
  assert.equal(signal.aborted, true);
  let canceled = false;
  const stream = new ReadableStream({ pull() { return new Promise(() => {}); }, cancel() { canceled = true; } });
  await assert.rejects(resolveReference('https://c.y.qq.com/share', { timeoutMs: 20, fetch: async () => new Response(stream) }), code('TIMEOUT'));
  assert.equal(canceled, true);
});

test('HTTP failures, missing redirects, unrecognized HTML and unwanted automatic redirect responses fail cleanly', async () => {
  for (const [response, errorCode] of [
    [new Response('not found', { status: 404 }), 'HTTP_ERROR'],
    [new Response(null, { status: 302 }), 'INVALID_REDIRECT'],
    [new Response('<a href="https://evil.test/">unrelated</a>'), 'NOT_A_SONG'],
    [new Response('<script>location.href=computeURL();</script>'), 'NOT_A_SONG'],
    [{ status: 200, redirected: true }, 'UNEXPECTED_REDIRECT'],
    [{ status: 200, url: 'https://evil.test/' }, 'UNEXPECTED_REDIRECT'],
    [null, 'INVALID_RESPONSE'],
  ]) {
    await assert.rejects(resolveReference('https://c.y.qq.com/share', { fetch: async () => response }), code(errorCode));
  }
  await assert.rejects(resolveReference('https://c.y.qq.com/share', { fetch: async () => { throw new Error('offline'); } }), /offline/);
});

test('resolver validates bounds and transport options', async () => {
  for (const options of [{ maxHops: -1 }, { maxHops: 17 }, { maxHops: 1.5 }, { maxBodyBytes: 0 }, { maxBodyBytes: 1048577 },
    { timeoutMs: 0 }, { timeoutMs: 60001 }, { signal: {} }]) {
    await assert.rejects(resolveReference(qqURL, options), code('INVALID_OPTIONS'));
  }
  await assert.rejects(resolveReference('https://c.y.qq.com/share', { fetch: true }), code('INVALID_OPTIONS'));
});
