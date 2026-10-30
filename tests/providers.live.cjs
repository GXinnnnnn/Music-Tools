'use strict';
// Opt-in smoke test: $env:MUSIC_TOOLS_LIVE='1'; node --test tests/providers.live.cjs
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { search, enrich } = require('../source/core/providers.cjs');

test('live public providers return multilingual candidates and lyrics/artwork', { skip: process.env.MUSIC_TOOLS_LIVE !== '1', timeout: 120000 }, async () => {
  let successes = 0;
  for (const [query, local, country] of [
    ['宇多田ヒカル First Love', { title: 'First Love', artist: '宇多田ヒカル', duration: 257 }, 'JP'],
    ['周杰伦 晴天', { title: '晴天', artist: '周杰伦', duration: 269 }, 'CN']
  ]) {
    const result = await search(query, { country, local, limit: 5, timeoutMs: 8000, retries: 0 });
    console.log(JSON.stringify({ query, providers: ['netease', 'itunes', 'musicbrainz'].map(source => ({ source, count: result.candidates.filter(c => c.source === source).length, example: result.candidates.find(c => c.source === source), error: result.errors.find(e => e.source === source) })) }, null, 2));
    successes += result.candidates.length;
    // Probe every provider's enrichment once; lack of a particular lyric/cover is not a test failure.
    if (query.startsWith('宇')) {
      const selected = ['netease', 'itunes', 'musicbrainz'].map(source => result.candidates.find(c => c.source === source)).filter(Boolean);
      const tags = await Promise.all(selected.map(candidate => enrich(candidate, { timeoutMs: 8000, retries: 0 })));
      for (const item of tags) console.log(JSON.stringify({ enrichment: item.source, title: item.title, coverUrl: item.coverUrl, lyricsCharacters: item.lyrics.length, lyricSample: item.lyrics.slice(0, 120), errors: item.errors }, null, 2));
    }
  }
  assert.ok(successes > 0, 'All public providers failed; inspect the reported network errors.');
});
