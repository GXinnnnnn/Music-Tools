'use strict';

// Public metadata only: these adapters never request song audio or authenticated APIs.
module.exports = function adapters({ request, normalize, text, number, year, artists, ProviderError, wants, aborted }) {
  const https = value => text(value).replace(/^http:/, 'https:');
  function requireSuccess(data, source) {
    if ((data.code !== undefined && Number(data.code) !== 0 && Number(data.code) !== 200)
      || (data.retcode !== undefined && Number(data.retcode) !== 0) || data.success === false) {
      throw new ProviderError('PROVIDER_ERROR', `${source}: ${data.message || data.msg || `code ${data.code ?? data.retcode}`}`);
    }
  }
  // Decode entities as text, never interpret markup returned by a provider.
  function unescape(value) {
    return text(value).replace(/&(?:amp|quot|apos|lt|gt|nbsp);|&#(?:x[\da-f]+|\d+);/gi, entity => {
      const named = { '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>', '&nbsp;': ' ' };
      if (named[entity.toLowerCase()]) return named[entity.toLowerCase()];
      const code = entity[2].toLowerCase() === 'x' ? parseInt(entity.slice(3), 16) : parseInt(entity.slice(2), 10);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity;
    });
  }
  async function qq(query, options) {
    const params = new URLSearchParams({ w: query, format: 'json', p: '1', n: String(options.limit), ct: '24', new_json: '0' });
    const data = await request(`https://c.y.qq.com/soso/fcgi-bin/client_search_cp?${params}`, options);
    requireSuccess(data, 'QQ Music');
    const songs = data.data?.song?.list;
    if (!Array.isArray(songs)) throw new ProviderError('INVALID_RESPONSE', 'QQ Music returned no song list.');
    return songs.filter(x => (x.songmid || x.mid || x.songid || x.id) && (x.songname || x.name || x.title)).map(x => {
      const mid = text(x.songmid || x.mid), albumMid = text(x.albummid || x.album?.mid);
      const result = normalize('qq', mid || x.songid || x.id, {
        title: unescape(x.songname || x.name || x.title), artist: artists(x.singer), album: unescape(x.albumname || x.album?.name),
        year: x.pubtime ? new Date(Number(x.pubtime) * 1000).getUTCFullYear() : x.time_public,
        track: x.index_album || x.cdIdx, disc: x.index_cd, duration: x.interval,
        coverUrl: albumMid && wants(options, 'cover') ? `https://y.gtimg.cn/music/photo_new/T002R800x800M000${encodeURIComponent(albumMid)}.jpg` : '',
        url: mid ? `https://y.qq.com/n/ryqq/songDetail/${encodeURIComponent(mid)}` : `https://y.qq.com/n/ryqq/songDetail/${x.songid || x.id}`
      });
      return result;
    });
  }
  async function qqLyrics(candidate, options) {
    const id = text(candidate.id).replace(/^qq:/, '');
    const params = new URLSearchParams({ format: 'json', nobase64: '1', g_tk: '5381', [/^\d+$/.test(id) ? 'musicid' : 'songmid']: id });
    const data = await request(`https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?${params}`, options);
    requireSuccess(data, 'QQ Music lyrics');
    if (!text(data.lyric)) throw new ProviderError('NOT_FOUND', 'QQ Music has no lyrics for this recording.');
    return { syncedLyrics: unescape(data.lyric), translatedLyrics: unescape(data.trans) };
  }
  async function kuwo(query, options) {
    const params = new URLSearchParams({ all: query, ft: 'music', itemset: 'web_2013', client: 'kt', pn: '0', rn: String(options.limit), rformat: 'json', encoding: 'utf8' });
    const data = await request(`https://search.kuwo.cn/r.s?${params}`, { ...options, responseFormat: 'kuwo' });
    if (!Array.isArray(data.abslist)) throw new ProviderError('INVALID_RESPONSE', 'Kuwo returned no song list.');
    return data.abslist.filter(x => /^MUSIC_\d+$/.test(text(x.MUSICRID)) && (x.SONGNAME || x.NAME)).map(x => {
      const id = text(x.MUSICRID).replace(/^MUSIC_/, '');
      const image = text(x.web_albumpic_short);
      return normalize('kuwo', id, {
        title: unescape(x.SONGNAME || x.NAME), artist: unescape(x.ARTIST), album: unescape(x.ALBUM),
        year: x.RELEASEDATE || x.PUBTIME, duration: x.DURATION, track: x.TRACK, disc: x.DISC,
        coverUrl: wants(options, 'cover') && image ? `https://img1.kwcdn.kuwo.cn/star/albumcover/${image.replace(/^\d+\//, '500/')}` : '',
        url: `https://www.kuwo.cn/play_detail/${id}`
      });
    });
  }
  async function kuwoCover(candidate, options) {
    if (candidate.coverUrl) return https(candidate.coverUrl);
    const id = text(candidate.id).replace(/^kuwo:/, '');
    if (!/^\d+$/.test(id)) throw new ProviderError('INVALID_CANDIDATE', 'A numeric Kuwo recording ID is required.');
    const params = new URLSearchParams({ type: 'rid_pic', pictype: 'album', size: '500', rid: id });
    const result = text(await request(`https://artistpicserver.kuwo.cn/pic.web?${params}`, { ...options, responseFormat: 'text' }));
    if (!/^https?:\/\/[^\s]+$/i.test(result)) throw new ProviderError('NOT_FOUND', 'Kuwo has no album artwork for this recording.');
    return https(result);
  }
  async function kuwoLyrics(candidate, options) {
    const id = text(candidate.id).replace(/^kuwo:/, '');
    if (!/^\d+$/.test(id)) throw new ProviderError('INVALID_CANDIDATE', 'A numeric Kuwo recording ID is required.');
    const data = await request(`https://www.kuwo.cn/openapi/v1/www/lyric/getlyric?${new URLSearchParams({ musicId: id })}`, options);
    requireSuccess(data, 'Kuwo lyrics');
    const lines = data.data?.lrclist;
    if (!Array.isArray(lines) || !lines.length) throw new ProviderError('NOT_FOUND', 'Kuwo has no timed lyrics for this recording.');
    const synced = lines.filter(x => Number.isFinite(Number(x.time)) && Number(x.time) >= 0).map(x => {
      const centiseconds = Math.round(Number(x.time) * 100);
      return `[${String(Math.floor(centiseconds / 6000)).padStart(2, '0')}:${String(Math.floor(centiseconds / 100) % 60).padStart(2, '0')}.${String(centiseconds % 100).padStart(2, '0')}]${unescape(x.lineLyric)}`;
    }).join('\n');
    if (!synced) throw new ProviderError('NOT_FOUND', 'Kuwo returned no valid timed lyric lines.');
    return { syncedLyrics: synced, plainLyrics: lines.map(x => unescape(x.lineLyric)).join('\n') };
  }
  const name = names => typeof names === 'string' ? text(names) : text(names?.English || names?.en || names?.['ja-latn'] || names?.Japanese || names?.ja || Object.values(names || {}).find(x => typeof x === 'string'));
  const credits = list => (Array.isArray(list) ? list : []).map(x => name(x.names) || text(x.name)).filter(Boolean).join(' / ');
  const albumId = link => text(link).match(/(?:^|\/)album\/(\d+)(?:\/?$|[?#])/i)?.[1] || '';
  async function vgmdb(query, options) {
    // VGMdb indexes albums, not recordings. Track candidates require a real tracklist.
    // Do not turn album names or album-wide composer credits into recording identity.
    if (!['album', 'albumArtist', 'year', 'track', 'disc', 'cover', 'composer', 'lyricist'].some(field => wants(options, field))) {
      throw new ProviderError('UNSUPPORTED_FIELDS', 'VGMdb is album-oriented; enable album, cover, year, track, disc or album credits to search its tracklists.');
    }
    const direct = query.match(/^(?:https?:\/\/(?:www\.)?vgmdb\.(?:net|info)\/)?album\/(\d+)\/?(?:\?[^\s]*)?$/i);
    let albums;
    if (direct) albums = [{ link: `album/${direct[1]}` }];
    else {
      const searchTerm = text(options.local?.album) || query;
      const data = await request(`https://vgmdb.info/search/${encodeURIComponent(searchTerm)}?format=json`, options);
      if (!Array.isArray(data.results?.albums)) throw new ProviderError('INVALID_RESPONSE', 'VGMdb.info returned no album results.');
      albums = data.results.albums;
    }
    const candidates = [];
    const seen = new Set();
    // At most three albums and at most 50 tracks per search; no unbounded fan-out.
    for (const album of albums.slice(0, Math.min(3, options.limit))) {
      aborted(options.signal);
      const id = albumId(album.link);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      const data = await request(`https://vgmdb.info/album/${id}?format=json`, options);
      if (!Array.isArray(data.discs)) throw new ProviderError('INVALID_RESPONSE', 'VGMdb.info returned no album tracklist.');
      const albumName = name(data.names) || text(data.name) || name(album.titles);
      for (const [discIndex, disc] of data.discs.entries()) {
        for (const [trackIndex, track] of (disc.tracks || []).entries()) {
          const title = name(track.names);
          if (!title) continue;
          const length = text(track.track_length).match(/^(\d+):(\d{2})(?:\.(\d+))?$/);
          const candidate = normalize('vgmdb', `${id}:${discIndex + 1}:${trackIndex + 1}`, {
            title, artist: credits(track.performers), album: albumName, albumArtist: credits(data.performers),
            year: data.release_date, track: trackIndex + 1, disc: discIndex + 1,
            duration: length ? Number(length[1]) * 60 + Number(length[2]) + Number(`0.${length[3] || 0}`) : null,
            coverUrl: wants(options, 'cover') ? https(data.picture_full || data.picture_small) : '', url: `https://vgmdb.net/album/${id}`
          });
          if (wants(options, 'composer')) candidate.composer = credits(data.composers);
          if (wants(options, 'lyricist')) candidate.lyricist = credits(data.lyricists);
          candidates.push(candidate);
        }
      }
    }
    // Return the whole bounded tracklist so common late-disc tracks can be identified.
    return candidates.slice(0, 600);
  }
  return { qq, kuwo, vgmdb, qqLyrics, kuwoLyrics, kuwoCover };
};
