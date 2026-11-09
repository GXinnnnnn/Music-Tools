const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  protocol,
  net,
} = require("electron");
const fs = require("node:fs");
const fsp = fs.promises;
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const audio = require("./core/audio.cjs");
const providers = require("./core/providers.cjs");
const syncPolicy = require("./core/sync-policy.cjs");
protocol.registerSchemesAsPrivileged([
  {
    scheme: "music-local",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: false,
    },
  },
]);
const portableRoot = app.isPackaged
  ? path.dirname(process.execPath)
  : path.resolve(__dirname, "..");
const installed = app.isPackaged && fs.existsSync(path.join(process.resourcesPath, "installed-mode"));
const dataDir = process.env.MUSIC_TOOLS_DATA_DIR || (installed
  ? path.join(app.getPath("appData"), "Music Tools")
  : path.join(portableRoot, "data"));
fs.mkdirSync(dataDir, { recursive: true });
app.setPath("userData", path.join(dataDir, "profile"));
audio.setDataDir(dataDir);
const preferences = require('./core/preferences.cjs').createPreferences(dataDir);
let win, controller, refreshController;
const progress = data => { if (win && !win.isDestroyed()) win.webContents.send('task-progress', data); };

const known = new Set();
const records = new Map();
function remember(record) {
  if (record?.path) { const p = path.resolve(record.path); known.add(p); records.set(p, record); }
  return record;
}
function mergedLocal(p, local = {}) {
  const record = records.get(path.resolve(p)) || {};
  return { ...record, ...local, tags: { ...record.tags, ...(local.tags || local) },
    cover: Object.hasOwn(local, 'cover') ? local.cover : record.cover };
}
function searchOptions(local, options = {}) {
  const fields = syncPolicy.effectiveFields(local, options);
  return { ...options, fields, local: syncPolicy.searchLocal(local, options), artwork: fields.includes('cover'), lyrics: fields.includes('lyrics') };
}
async function stagedCandidate(item, options, signal, images) {
  const p = allow(item.path), local = mergedLocal(p, item.local || {});
  const effective = searchOptions(local, options);
  if (!effective.fields.length) return { path: p, tags: {}, skipped: true, errors: [] };
  const enriched = await providers.enrich(item.candidate, { ...effective, signal });
  signal.throwIfAborted();
  const proposal = { tags: enriched }, errors = [...(enriched.errors || [])];
  if (effective.fields.includes('cover') && enriched.coverUrl) {
    try {
      if (!images.has(enriched.coverUrl)) {
        const pending = require('./core/downloads.cjs').downloadCover(enriched.coverUrl, { signal }).then(image => {
          if (require('electron').nativeImage.createFromDataURL(image).isEmpty()) throw new Error('下载的封面图片无法解码');
          return image;
        });
        // Cache in-flight downloads too: parallel recordings can share the same album cover.
        if (images.size >= 32) images.delete(images.keys().next().value);
        images.set(enriched.coverUrl, pending);
      }
      const pending = images.get(enriched.coverUrl);
      try { proposal.cover = await pending; }
      catch (error) { if (images.get(enriched.coverUrl) === pending) images.delete(enriched.coverUrl); throw error; }
    } catch (e) {
      if (signal.aborted) throw e;
      errors.push({ source: item.candidate.source, message: e.message });
    }
  }
  signal.throwIfAborted();
  return { path: p, ...syncPolicy.planPatch(local, proposal, options), errors };
}
const allow = (p) => {
  p = path.resolve(p);
  if (!known.has(p)) throw new Error("请先导入此音频文件");
  return p;
};
const handle = (name, fn) =>
  ipcMain.handle(name, async (_e, ...args) => {
    try {
      return { ok: true, value: await fn(...args) };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });
async function scan(paths) {
  const result = await audio.scan(paths);
  for (const f of result.files) remember(f);
  return result;
}
function jobsSafe(jobs) {
  if (!Array.isArray(jobs) || jobs.length > 20000)
    throw new Error("文件数量无效");
  return jobs.map((j) => ({ ...j, path: allow(j.path) }));
}
handle("choose-import", async (folder) => {
  const r = await dialog.showOpenDialog(win, {
    title: folder ? "导入音乐文件夹" : "导入本地音频",
    properties: folder ? ["openDirectory"] : ["openFile", "multiSelections"],
    filters: folder
      ? []
      : [
          {
            name: "音频文件",
            extensions: [
              "mp3",
              "flac",
              "m4a",
              "m4b",
              "ogg",
              "oga",
              "opus",
              "wav",
              "wave",
              "aif",
              "aiff",
              "aifc",
              "ape",
              "wma",
              "asf",
              "wv",
              "dsf",
              "dff",
              "dsdiff",
              "mp4",
              "mpc",
              "tta",
              "ofr",
              "ofs",
              "spx",
            ],
          },
        ],
  });
  return r.canceled ? { files: [], errors: [] } : scan(r.filePaths);
});
handle("import-paths", scan);
handle('preferences-get', () => preferences.get());
handle('preferences-set', patch => preferences.set(patch));
handle('refresh', async (paths, options = {}) => {
  if (!Array.isArray(paths) || paths.length > 20000) throw new Error('文件数量无效');
  if (refreshController) throw new Error('刷新任务正在进行中');
  const task = refreshController = new AbortController();
  const files = [], errors = [], valid = [], operationId = String(options.operationId || '').slice(0, 100);
  try {
    for (const p of [...new Set(paths)]) {
      try { valid.push(allow(p)); } catch (e) { errors.push({ path: p, error: e.message }); }
    }
    progress({ kind: 'refresh', operationId, done: 0, total: valid.length });
    // Each group shares one Python process, rather than starting one for every recording.
    for (let start = 0; start < valid.length && !task.signal.aborted; start += 16) {
      const group = valid.slice(start, start + 16);
      try {
        const result = await audio.scan(group);
        files.push(...result.files.map(remember)); errors.push(...result.errors);
      } catch (error) { errors.push(...group.map(p => ({ path: p, error: error.message }))); }
      progress({ kind: 'refresh', operationId, done: Math.min(start + group.length, valid.length), total: valid.length });
    }
    return { files, errors, canceled: task.signal.aborted };
  } finally { if (refreshController === task) refreshController = null; }
});
handle('cancel-task', kind => {
  if (kind === 'refresh') refreshController?.abort();
  else if (kind === 'match' || kind === 'stage') controller?.abort();
  else throw new Error('未知任务');
  return true;
});
handle('clear-tags', async jobs => {
  if (!Array.isArray(jobs) || jobs.length !== 1) throw new Error('请只选择一首音频以删除所有条目');
  const result = await audio.clearBatch(jobsSafe(jobs), await preferences.get());
  for (const item of result.results || []) if (item.record) remember(item.record);
  return result;
});
handle("write", async (jobs, options) => {
  const result = await audio.writeBatch(jobsSafe(jobs), { ...(options || {}), ...await preferences.get() });
  for (const item of result.results || []) if (item.record) remember(item.record);
  return result;
});
handle("history", () => audio.history());
handle("restore", async (id) => {
  const result = await audio.restore(id);
  remember(result.record);
  return result;
});
handle("rename-preview", (jobs, pattern) =>
  audio.renamePreview(jobsSafe(jobs), pattern),
);
handle("rename", async (jobs, pattern) => {
  const r = await audio.renameBatch(jobsSafe(jobs), pattern, await preferences.get());
  for (const item of r.results)
    if (item.record?.path) remember(item.record);
  return r;
});
handle("export-sidecars", (jobs, options) =>
  audio.exportSidecars(jobsSafe(jobs), options),
);
handle("search", async (query, options = {}) => {
  controller?.abort();
  controller = new AbortController();
  const effective = searchOptions(options.local || {}, options);
  if (!effective.fields.length) return { candidates: [], errors: [], skipped: true };
  return providers.search(String(query).slice(0, 500), { ...effective, signal: controller.signal });
});
handle("enrich", async (candidate, options = {}) => {
  controller?.abort();
  controller = new AbortController();
  const effective = searchOptions(options.local || {}, options);
  if (!effective.fields.length) return { errors: [], skipped: true };
  return providers.enrich(candidate, { ...effective, signal: controller.signal });
});
handle("sync-filter", (p, proposal, options = {}, local = {}) => syncPolicy.planPatch(mergedLocal(allow(p), local), proposal, options));
handle("batch-stage", async (items, options = {}) => {
  if (!Array.isArray(items) || items.length > 20000) throw new Error('文件数量无效');
  controller?.abort(); controller = new AbortController();
  const signal = controller.signal, results = [], errors = [], images = new Map();
  let next = 0, done = 0;
  const operationId = String(options.operationId || '').slice(0, 100);
  const worker = async () => {
    while (next < items.length && !signal.aborted) {
      const item = items[next++];
      try { results.push(await stagedCandidate(item, options, signal, images)); }
      catch (e) { if (signal.aborted) break; errors.push({ path: item.path, error: e.message, message: e.message }); }
      const event = { kind: 'stage', operationId, done: ++done, total: items.length };
      progress(event); win?.webContents.send('match-progress', event);
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, items.length) }, worker));
  const order = new Map(items.map((item, i) => [item.path, i]));
  results.sort((a, b) => order.get(a.path) - order.get(b.path));
  return { results, errors, canceled: signal.aborted };
});
handle("cancel-search", () => {
  controller?.abort();
  return true;
});
handle("batch-match", async (items, options = {}) => {
  if (!Array.isArray(items) || items.length > 20000) throw new Error('文件数量无效');
  controller?.abort(); controller = new AbortController();
  const signal = controller.signal, results = [], errors = [];
  let next = 0, done = 0;
  // Three recording lookups overlap network latency; each provider owns its own rate limit.
  const worker = async () => {
    while (next < items.length && !signal.aborted) {
      const index = next++, item = items[index];
      try {
        const p = allow(item.path), current = mergedLocal(p, item.local || {}), effective = searchOptions(current, options);
        if (!effective.fields.length) results.push({ path: p, candidates: [], recommendedIndex: -1, errors: [], skipped: true });
        else {
          const local = effective.local;
          const r = await providers.search(providers.lookupQuery(local), { ...effective, autoFilename: true, signal });
          const ranked = providers.rankCandidates(local, r.candidates, options);
          results.push({ path: p, candidates: ranked.slice(0, 8),
            recommendedIndex: ranked[0] && providers.isRecommendedCandidate(local, ranked[0]) && !ranked.slice(1).some(c => providers.isRecommendedCandidate(local, c) && c.artist?.toLowerCase() !== ranked[0].artist?.toLowerCase() && ranked[0].score - c.score < 8) ? 0 : -1,
            errors: r.errors });
        }
      } catch (e) {
        if (signal.aborted) break;
        errors.push({ path: item.path, error: e.message });
      }
      const event = { kind: 'match', operationId: String(options.operationId || '').slice(0, 100), done: ++done, total: items.length };
      progress(event); win?.webContents.send('match-progress', event);
    }
  };
  await Promise.all(Array.from({ length: Math.min(3, items.length) }, worker));
  const order = new Map(items.map((item, i) => [item.path, i]));
  results.sort((a, b) => order.get(a.path) - order.get(b.path));
  return { results, errors, canceled: signal.aborted };
});
// Lyrics are a separate job family so cancelling their dialog cannot cancel tag matching.
let lyricController;
const lyricDirectories = new Set(), lyricOutputs = new Set();
const lyricService = () => require('./core/lyric-service.cjs');
function beginLyrics() {
  lyricController?.abort();
  lyricController = new AbortController();
  return lyricController.signal;
}
function lyricDirectory(directory) {
  if (!directory) return undefined;
  const resolved = path.resolve(directory);
  if (!lyricDirectories.has(resolved)) throw new Error('请重新选择歌词导出文件夹');
  return resolved;
}
handle('lyric-search', (query, options = {}) => lyricService().search(String(query || '').slice(0, 500), {
  sources: options.sources, local: options.local, signal: beginLyrics(),
}));
handle('lyric-fetch', (candidate) => lyricService().fetchLyrics(candidate, { signal: beginLyrics() }));
handle('lyric-resolve', (input, options = {}) => lyricService().resolve(input, { source: options.source, signal: beginLyrics() }));
handle('lyric-preview', (data, options) => lyricService().preview(data, options));
handle('lyric-filename', (job) => {
  const audioPath = job.audioPath ? allow(job.audioPath) : undefined, record = records.get(audioPath);
  return lyricService().filenames({ audioPath, options: job.options,
    metadata: lyricService().filenameMetadata(job.metadata || {}, job.direct === true ? {} : record?.tags || {}) });
});
handle('lyric-directory', async () => {
  const result = await dialog.showOpenDialog(win, { title: '选择歌词导出文件夹', properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled) return null;
  const directory = await fsp.realpath(result.filePaths[0]);
  lyricDirectories.add(directory);
  return directory;
});
handle('lyric-export', async (job) => {
  const audioPath = job.audioPath ? allow(job.audioPath) : undefined, record = records.get(audioPath);
  const saved = await lyricService().exportLyrics({ ...job, audioPath, directory: lyricDirectory(job.directory),
    metadata: lyricService().filenameMetadata(job.metadata || {}, job.direct === true ? {} : record?.tags || {}),
    options: { ...job.options, duration: job.direct === true ? job.options?.duration : record?.duration || job.options?.duration } }, { signal: beginLyrics() });
  for (const file of saved.files) lyricOutputs.add(file.path);
  return saved;
});
handle('lyric-batch', async (items, options = {}) => {
  const jobs = jobsSafe(items).map(item => ({ path: item.path, local: mergedLocal(item.path, item.local || {}) }));
  const result = await lyricService().batch(jobs, { ...lyricService().conversionOptions(options), sources: options.sources,
    directory: lyricDirectory(options.directory), signal: beginLyrics(),
    onProgress: progress => { if (!win?.isDestroyed()) win?.webContents.send('lyric-progress', { ...progress, operationId: String(options.operationId || '').slice(0, 100) }); } });
  for (const row of result.results) for (const file of row.outputs || (row.output ? [row.output] : [])) lyricOutputs.add(file);
  return result;
});
handle('lyric-cancel', () => { lyricController?.abort(); return true; });
handle('lyric-reveal', (p) => {
  const resolved = path.resolve(p);
  if (!lyricOutputs.has(resolved)) throw new Error('请先导出此歌词文件');
  shell.showItemInFolder(resolved);
});
handle("choose-cover", async () => {
  const r = await dialog.showOpenDialog(win, {
    title: "选择本地封面",
    properties: ["openFile"],
    filters: [{ name: "封面图片", extensions: ["jpg", "jpeg", "png", "webp"] }],
  });
  if (r.canceled) return null;
  const file = r.filePaths[0],
    stat = await fsp.stat(file);
  if (stat.size > 20 * 1024 * 1024) throw new Error("封面需小于 20 MB");
  const { nativeImage } = require("electron");
  const image = nativeImage.createFromPath(file);
  if (image.isEmpty()) throw new Error("无法读取图片");
  const size = image.getSize();
  if (size.width > 8192 || size.height > 8192)
    throw new Error("封面边长请小于 8192 像素");
  return "data:image/jpeg;base64," + image.toJPEG(94).toString("base64");
});
handle("choose-lyrics", async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ["openFile"],
    filters: [{ name: "歌词", extensions: ["lrc", "txt"] }],
  });
  return r.canceled ? null : await fsp.readFile(r.filePaths[0], "utf8");
});
handle("download-cover", async (url) => {
  const value = await require('./core/downloads.cjs').downloadCover(url);
  if (require('electron').nativeImage.createFromDataURL(value).isEmpty())
    throw new Error('下载的封面图片无法解码');
  return value;
});
handle("transform-cover", (value, options = {}) => {
  const { nativeImage } = require("electron");
  let image = nativeImage.createFromDataURL(value);
  if (image.isEmpty()) throw new Error("无法读取封面图片");
  const dimensions = image.getSize();
  const limit = Number(options.maxSize) || 0;
  if (limit > 0 && Math.max(dimensions.width, dimensions.height) > limit) {
    const ratio = limit / Math.max(dimensions.width, dimensions.height);
    image = image.resize({
      width: Math.max(1, Math.round(dimensions.width * ratio)),
      height: Math.max(1, Math.round(dimensions.height * ratio)),
      quality: "best",
    });
  }
  const png = options.format === "png";
  return `data:image/${png ? "png" : "jpeg"};base64,${(png ? image.toPNG() : image.toJPEG(92)).toString("base64")}`;
});
handle("show-file", (p) => shell.showItemInFolder(allow(p)));
handle("open-data", () => shell.openPath(dataDir));
handle("window", (action) => {
  if (action === "close") win.close();
  if (action === "minimize") win.minimize();
  if (action === "maximize")
    win.isMaximized() ? win.unmaximize() : win.maximize();
});
handle("demo", async () => {
  const from = path.join(__dirname, "demo"),
    to = path.join(dataDir, "demo");
  await fsp.mkdir(to, { recursive: true });
  for (const name of await fsp.readdir(from)) {
    if (!fs.existsSync(path.join(to, name)))
      await fsp.copyFile(path.join(from, name), path.join(to, name));
  }
  return scan([to]);
});
handle("get-info", () => ({
  version: app.getVersion(),
  dataDir,
  portable: !installed,
  distribution: installed ? 'installed' : 'portable',
}));
let sessionQueue = Promise.resolve();
handle("session-load", async () => {
  try {
    return JSON.parse(
      await fsp.readFile(path.join(dataDir, "session.json"), "utf8"),
    );
  } catch {
    return null;
  }
});
handle("session-save", async (state) => {
  sessionQueue = sessionQueue
    .catch(() => {})
    .then(async () => {
      const tmp = path.join(dataDir, "session.json.tmp");
      await fsp.writeFile(tmp, JSON.stringify(state));
      await fsp.rename(tmp, path.join(dataDir, "session.json"));
    });
  return sessionQueue;
});
handle("text-tools", (action, items, options) => {
  const tools = require("./core/text-tools.cjs");
  return items.map((item) => {
    try {
      let tags;
      if (action === "filename")
        tags = tools.tagsFromFilename(
          item.filename,
          options.pattern,
          options.regex,
        );
      else if (action === "replace")
        tags = tools.replaceTags(item.tags, options);
      else if (action === "lyrics")
        tags = { lyrics: tools.cleanLyrics(item.tags.lyrics || "", options) };
      else if (action === "chinese")
        tags = tools.convertTags(item.tags, options);
      else if (action === "clear") tags = tools.clearTags(options.fields);
      else throw new Error("未知文字工具");
      return { path: item.path, tags };
    } catch (e) {
      return { path: item.path, error: e.message };
    }
  });
});
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(() => {
    app.setAppUserModelId("MusicTools.Portable");
    protocol.handle("music-local", (request) => {
      try {
        const p = Buffer.from(
          new URL(request.url).pathname.slice(1),
          "base64url",
        ).toString("utf8");
        return net.fetch(pathToFileURL(allow(p)).href);
      } catch {
        return new Response("Forbidden", { status: 403 });
      }
    });
    win = new BrowserWindow({
      width: 1460,
      height: 940,
      minWidth: 980,
      minHeight: 680,
      title: "Music Tools",
      icon: path.join(__dirname, "ui/assets/icon.png"),
      frame: false,
      backgroundColor: "#e8e9f1",
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    win.webContents.on("will-navigate", (event, url) => {
      if (url !== pathToFileURL(path.join(__dirname, "ui/index.html")).href)
        event.preventDefault();
    });
    win.loadFile(path.join(__dirname, "ui/index.html"));
    win.once("ready-to-show", () => win.show());
  });
  app.on("window-all-closed", () => app.quit());
}
