"use strict";
const $ = (s) => document.querySelector(s),
  $$ = (s) => [...document.querySelectorAll(s)];
const api = (name, ...args) => window.music.invoke(name, ...args);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const icons = {
  audio: '<path d="M4 10v4m4-8v12m4-15v18m4-15v12m4-8v4"/>',
  music:
    '<path d="M9 18V5l12-2v13M9 7l12-2"/><ellipse cx="6" cy="18" rx="3" ry="3"/><ellipse cx="18" cy="16" rx="3" ry="3"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  sparkle:
    '<path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z"/><path d="m20 2 .6 1.4L22 4l-1.4.6L20 6l-.6-1.4L18 4l1.4-.6Z"/>',
  edit: '<path d="m15 5 4 4M4 20l5-1L21 7a2.8 2.8 0 0 0-4-4L5 15Z"/>',
  "check-circle": '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  folder:
    '<path d="M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z"/>',
  "folder-plus":
    '<path d="M3 7V5a1 1 0 0 1 1-1h5l2 3h9a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1Z"/><path d="M12 10v7m-3-3.5h6"/>',
  sliders:
    '<path d="M4 7h7m5 0h4M4 17h3m5 0h8"/><circle cx="13" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  history: '<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7m2-4v5l3 2"/>',
  settings:
    '<path d="m10 3-1 3-3 1-3 2 1 3-1 3 3 2 3 1 1 3h4l1-3 3-1 3-2-1-3 1-3-3-2-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/>',
  shield:
    '<path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z"/><path d="m8.5 12 2.5 2.5 4.5-5"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-2.9 2.3-2.9 4"/><circle cx="12" cy="17" r=".65" fill="currentColor" stroke="none"/>',
  "arrow-right": '<path d="M4 12h16m-6-6 6 6-6 6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  square: '<rect x="5" y="5" width="14" height="14" rx="1"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  moon: '<path d="M20.5 13A9 9 0 0 1 11 3.5 9 9 0 1 0 20.5 13Z"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  refresh:
    '<path d="M21 12a9 9 0 1 1-2.64-6.36L21 8"/><path d="M21 3v5h-5"/>',
  "minus-circle": '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v6m4-6v6"/>',
  save: '<path d="M5 3h12l4 4v14H3V3Zm2 0v7h10V3M7 21v-7h10v7"/>',
  play: '<path d="m8 4 12 8-12 8Z"/>',
  pause: '<path d="M8 4v16M16 4v16"/>',
  image:
    '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
  file: '<path d="M14 3H5v18h14V8Zm0 0v6h5M8 13h8m-8 4h8"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 10v7m0-11h.01"/>',
  lyrics: '<path d="M4 5h16M4 10h12M4 15h16M4 20h9"/>',
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.music}</svg>`;
function hydrate(root = document) {
  root
    .querySelectorAll("[data-icon]")
    .forEach((el) => (el.innerHTML = icon(el.dataset.icon)));
}
const FIELDS = {
  title: "标题",
  artist: "艺术家",
  album: "专辑",
  albumArtist: "专辑艺术家",
  year: "年份",
  track: "音轨",
  disc: "碟号",
  genre: "流派",
  composer: "作曲",
  lyricist: "作词",
  comment: "注释",
  lyrics: "歌词",
};
const SYNC_FIELDS = { cover: "封面", ...FIELDS };
const PLATFORM_ORDER = ["qq", "netease", "itunes", "kuwo", "musicbrainz", "vgmdb"];
const sources = {
  qq: "QQ 音乐",
  netease: "网易云音乐",
  itunes: "iTunes",
  kuwo: "酷我音乐",
  musicbrainz: "MusicBrainz",
  vgmdb: "VGMdb",
  lrclib: "LRCLIB",
  coverartarchive: "封面存档",
};
const hasValue = (value) => value !== null && value !== undefined && String(value).trim() !== "";
const validFields = (value) => [...new Set(value.filter((key) => Object.hasOwn(SYNC_FIELDS, key)))];
let storedSettings = {};
try {
  const parsed = JSON.parse(localStorage.getItem("settings") || "{}");
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
    storedSettings = parsed;
} catch {}
let settings = {
  ...storedSettings,
  completionVersion: 2,
  sources: storedSettings.completionVersion >= 2 && Array.isArray(storedSettings.sources)
    ? PLATFORM_ORDER.filter((key) => storedSettings.sources.includes(key))
    : ["qq", "netease"],
  fields: Array.isArray(storedSettings.fields)
    ? validFields(storedSettings.fields)
    : Object.keys(SYNC_FIELDS),
  overwriteFields: Array.isArray(storedSettings.overwriteFields)
    ? validFields(storedSettings.overwriteFields)
    : storedSettings.fillOnly === false ? Object.keys(SYNC_FIELDS) : [],
  fillOnly: storedSettings.fillOnly !== false,
  threshold: Math.max(70, Math.min(99, Number(storedSettings.threshold) || 85)),
  backupEnabled: true,
  country: ["CN", "JP", "US"].includes(storedSettings.country)
    ? storedSettings.country
    : "CN",
};
function persistSettings() {
  settings.fillOnly = settings.overwriteFields.length === 0;
  localStorage.setItem("settings", JSON.stringify(settings));
}
persistSettings();
let files = [],
  selected = new Set(),
  active = null,
  filter = "all",
  drafts = {},
  done = new Set(),
  matches = {},
  previewTab = "tags",
  query = "",
  sort = "import",
  pageSize = 100,
  busy = false,
  persistTimer,
  undoQueue = null,
  playing = null;
let backgroundTask = null;
const previewTargets = () => selected.size ? [...selected] : active && current(active) ? [active] : [];
let indexedFiles = null;
let filesByPath = new Map();
function fileIndex() {
  // Rebuild after an array replacement; individual mutations update the same index.
  if (indexedFiles !== files) {
    filesByPath = new Map(files.map(record => [record.path, record]));
    indexedFiles = files;
  }
  return filesByPath;
}
function replaceFiles(records) {
  files = records;
  indexedFiles = null;
  fileIndex();
}
function appendRecord(record) {
  const index = fileIndex();
  files.push(record);
  index.set(record.path, record);
}
function replaceRecord(position, record) {
  const index = fileIndex(), previous = files[position];
  if (previous?.path !== record.path) index.delete(previous?.path);
  files[position] = record;
  index.set(record.path, record);
}
const current = (p) => fileIndex().get(p);
function updateBackupHint() {
  const enabled = settings.backupEnabled;
  const title = document.querySelector('.local-badge strong'), note = document.querySelector('.local-badge small');
  if(title)title.textContent = enabled ? '本地编辑 · 自动备份' : '本地编辑 · 备份已关闭';
  if(note)note.textContent = enabled ? '已有标签修改前自动备份' : '可在偏好设置中重新开启';
  document.querySelectorAll('.backup-hint').forEach(el => el.hidden = !enabled);
}
function renderBackgroundTask() {
  const strip = $('#background-task');
  strip.hidden = !backgroundTask && !batchSession;
  $('#background-task-stop').hidden = !backgroundTask;
  $('#background-task-progress').hidden = !backgroundTask;
  if (!backgroundTask) {
    if(batchSession) {
      $('#background-task-label').textContent = batchSession.canceled ? '批量任务已停止，已有结果已保留' : '批量补全结果已就绪';
      $('#background-task-count').textContent = batchSession.items.length + ' 首 · ' + batchSession.items.filter(i=>i.staged).length + ' 首已加入草稿';
      $('#background-task-view').hidden = false;
    }
    return;
  }
  const {kind,done,total,canceling} = backgroundTask;
  $('#background-task-label').textContent = (canceling ? '正在停止 · ' : '') + ({refresh:'重新读取标签与封面',match:'联网匹配',stage:'获取封面与歌词'}[kind]);
  $('#background-task-count').textContent = done + ' / ' + total;
  $('#background-task-progress').max = Math.max(1,total); $('#background-task-progress').value = done;
  $('#background-task-view').hidden = kind === 'refresh';
  $('#background-task-stop').disabled = !!canceling;
}
async function runBackground(kind, total, task) {
  if (busy || backgroundTask) { toast('请等待当前任务完成'); return; }
  const state = backgroundTask = {kind,total,done:0,id:crypto.randomUUID()};
  renderBackgroundTask(); updateButtons();
  try { return await task(state.id); }
  catch (error) {
    if ((kind === 'match' || kind === 'stage') && batchSession?.pending) {
      batchSession.pending = false; batchSession.canceled = true;
      batchSession.message = '任务未完成：' + error.message + '。已完成的结果仍可查看。';
      if ($('#batch-results') && $('#modal').open) finishBatchView();
    }
    toast(error.message,'error'); status('任务未完成，请查看错误信息。');
  }
  finally { if (backgroundTask === state) backgroundTask = null; renderBackgroundTask(); updateButtons(); updateBatchSelection(); }
}
async function stopBackgroundTask() {
  if(!backgroundTask)return;
  backgroundTask.canceling=true; renderBackgroundTask();
  await api('cancel-task',backgroundTask.kind);
}
window.music.onTaskProgress(event => {
  if(!backgroundTask || event.operationId !== backgroundTask.id)return;
  Object.assign(backgroundTask,{done:event.done,total:event.total}); renderBackgroundTask();
  if($('#batch-progress') && event.kind !== 'refresh')$('#batch-progress').textContent = (event.kind === 'stage' ? '正在获取封面与歌词 ' : '正在匹配 ') + event.done + ' / ' + event.total;
  if($('#batch-progress-bar') && event.kind !== 'refresh')$('#batch-progress-bar').style.width = (event.done / Math.max(1,event.total)*100)+'%';
});
const tags = (p) => ({ ...current(p)?.tags, ...drafts[p]?.tags });
const cover = (p) =>
  drafts[p] && Object.hasOwn(drafts[p], "cover")
    ? drafts[p].cover
    : current(p)?.cover;
const isMissing = (f) => {
  const values = tags(f.path);
  return !values.title || !values.artist || !values.album || !cover(f.path) || !values.lyrics;
};
const duration = (n) =>
  n
    ? `${Math.floor(n / 60)}:${String(Math.floor(n % 60)).padStart(2, "0")}`
    : "—";
const size = (n) =>
  n > 1048576
    ? `${(n / 1048576).toFixed(1)} MB`
    : `${Math.round((n || 0) / 1024)} KB`;
function artwork(value, alt = "", lazy = true) {
  return value
    ? `<img src="${esc(value)}" alt="${esc(alt)}" ${lazy ? 'loading="lazy"' : ""} decoding="async">`
    : `<span class="fallback-cover">${icon("music")}</span>`;
}
function basename(p) {
  return p.split(/[\\/]/).pop();
}
function toast(message, type = "", action) {
  const el = document.createElement("div");
  el.className = "toast " + type;
  el.innerHTML = `<span>${esc(message)}</span>${action ? `<button class="toast-action">${esc(action.label)}</button>` : ""}<button class="toast-close" aria-label="关闭提示">${icon("close")}</button>`;
  $("#toasts").append(el);
  if (action)
    el.querySelector(".toast-action").onclick = () => {
      action.run();
      el.remove();
    };
  el.querySelector(".toast-close").onclick = () => el.remove();
  setTimeout(() => el.remove(), type === "error" ? 16000 : 7000);
}
function status(message) {
  $("#operation-status").innerHTML =
    `${busy ? '<span class="busy-indicator"></span>' : icon("shield")}<span>${esc(message)}</span>`;
}
async function run(task, message) {
  if (busy || backgroundTask) {
    toast("当前操作完成后即可继续");
    return;
  }
  busy = true;
  status(message);
  updateButtons();
  try {
    return await task();
  } catch (e) {
    toast(e.message, "error");
    status("操作未完成，请查看错误信息。");
  } finally {
    busy = false;
    $("#operation-status .busy-indicator")?.remove();
    updateButtons();
  }
}
function persist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(
    () =>
      api("session-save", {
        paths: files.map((f) => f.path),
        drafts,
        done: [...done],
      }).catch((e) => toast("工作区暂存失败：" + e.message, "error")),
    250,
  );
}
function patch(paths, values, coverValue, renderNow = true) {
  for (const p of paths) {
    const record = current(p);
    if (!record) continue;
    const d = drafts[p] || { tags: {} };
    d.tags = { ...d.tags, ...values };
    if (coverValue !== undefined) d.cover = coverValue;
    for (const k of Object.keys(d.tags)) {
      if (String(record.tags[k] || "") === String(d.tags[k] || ""))
        delete d.tags[k];
    }
    if (Object.hasOwn(d, "cover") && d.cover === record.cover)
      delete d.cover;
    if (!Object.keys(d.tags).length && !Object.hasOwn(d, "cover"))
      delete drafts[p];
    else drafts[p] = d;
    done.delete(p);
  }
  persist();
  if(renderNow) { renderCounts(); renderGrid(); updateButtons(); }
}
function visibleFiles() {
  let list = files.filter(
    (f) =>
      filter === "all" ||
      (filter === "missing" && isMissing(f)) ||
      (filter === "draft" && drafts[f.path]) ||
      (filter === "done" && done.has(f.path)),
  );
  if (query) {
    const q = query.toLowerCase();
    list = list.filter((f) =>
      [f.filename, ...Object.values(tags(f.path))]
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }
  if (sort !== "import")
    list = [...list].sort((a, b) =>
      String(tags(a.path)[sort] || a.filename).localeCompare(
        String(tags(b.path)[sort] || b.filename),
        "zh-CN",
      ),
    );
  return list;
}
function renderCounts() {
  const missing = files.filter(isMissing).length;
  $("#count-all").textContent = files.length;
  $("#count-missing").textContent = missing;
  $("#count-draft").textContent = Object.keys(drafts).length;
  $("#count-done").textContent = done.size;
  $("#queue-count").textContent = `${files.length} 首`;
  $("#selection-count").textContent = selected.size
    ? `已选 ${selected.size}`
    : "";
  $("#save-count").textContent = Object.keys(drafts).length
    ? `写入全部草稿 · ${Object.keys(drafts).length}`
    : "写入全部草稿";
  const visible = visibleFiles();
  $("#select-all").checked =
    visible.length > 0 && visible.every((f) => selected.has(f.path));
  $("#select-all").indeterminate =
    visible.some((f) => selected.has(f.path)) && !$("#select-all").checked;
  $("#library-status").innerHTML =
    `<span class="status-dot"></span>${files.length ? `${visible.length} 首音频 · ${files.filter((f) => cover(f.path)).length} 张封面` : "准备就绪"}`;
}
const tileCache = new Map();
function renderGrid() {
  const list = visibleFiles();
  const grid = $("#album-grid");
  $("#empty-state").hidden = files.length > 0;
  grid.hidden = !files.length;
  $("#no-results").hidden = !files.length || list.length > 0;
  $("#load-more").hidden = list.length <= pageSize;
  const shown = list.slice(0, pageSize), wanted = new Set(shown.map(f => f.path));
  // Retain only displayed tiles, so removed files and large covers are released.
  for (const [key, entry] of tileCache) {
    if (!wanted.has(key)) { entry.node.remove(); tileCache.delete(key); }
  }
  let anchor = grid.firstElementChild;
  for (const f of shown) {
    const p = f.path, d = drafts[p], isDone = done.has(p);
    const draftTags = d?.tags, draftCover = d && Object.hasOwn(d, "cover") ? d.cover : undefined;
    let entry = tileCache.get(p);
    if (!entry || entry.record !== f || entry.draftTags !== draftTags || entry.draftCover !== draftCover || entry.isDone !== isDone) {
      const t = tags(p);
      const state = d ? "待写入" : isDone ? "已完成" : isMissing(f) ? "待补全" : "信息完整";
      const template = document.createElement("template");
      template.innerHTML = `<div class="audio-tile ${selected.has(p) ? "selected" : ""}" role="listitem" tabindex="0" data-path="${esc(p)}" aria-label="${esc(t.title || f.filename)}，${state}" aria-selected="${selected.has(p)}"><div class="tile-cover">${artwork(cover(p), (t.album || t.title || f.filename) + " 封面")}<button class="tile-checkbox" aria-label="${selected.has(p) ? "取消选择" : "选择"} ${esc(t.title || f.filename)}" data-select="${esc(p)}">${selected.has(p) ? icon("check") : ""}</button><span class="format-tag">${esc(f.format || "AUDIO")}</span></div><div class="tile-title" title="${esc(t.title || f.filename)}">${esc(t.title || f.filename)}</div><div class="tile-artist" title="${esc(t.artist || "未知艺术家")}">${esc(t.artist || "未知艺术家")} <span>· ${esc(t.album || "未填写专辑")}</span></div><div class="tile-meta"><span class="tile-status ${d ? "draft" : done.has(p) ? "done" : ""}">${icon(d ? "edit" : done.has(p) ? "check-circle" : "music")}${state}</span><span>${duration(f.duration)}</span></div></div>`;
      const fresh = template.content.firstElementChild;
      if (entry) {
        // Keep the focusable tile itself when its title/status changes.
        entry.node.replaceChildren(...fresh.childNodes);
        entry.node.setAttribute("aria-label", fresh.getAttribute("aria-label"));
      } else entry = { node: fresh };
      Object.assign(entry, { record: f, draftTags, draftCover, isDone, selected: null });
      tileCache.set(p, entry);
    }
    const chosen = selected.has(p);
    if (entry.selected !== chosen) {
      entry.node.classList.toggle("selected", chosen);
      entry.node.setAttribute("aria-selected", String(chosen));
      const checkbox = entry.node.querySelector(".tile-checkbox");
      checkbox.setAttribute("aria-label", (chosen ? "取消选择" : "选择") + " " + (tags(p).title || f.filename));
      checkbox.innerHTML = chosen ? icon("check") : "";
      entry.selected = chosen;
    }
    if (entry.node !== anchor) grid.insertBefore(entry.node, anchor);
    anchor = entry.node.nextElementSibling;
  }
  // No global SVG hydration: static icons were hydrated at boot; tile SVGs are inline.
}
function updateButtons() {
  const count = selected.size, locked = busy || !!backgroundTask;
  $$('[data-action="save-all"]').forEach(
    (b) => (b.disabled = locked || !Object.keys(drafts).length),
  );
  $$('[data-action="batch-match"],[data-action="remove"]').forEach(
    (b) => (b.disabled = locked || !count),
  );
  $$('[data-action="clear"],[data-action="refresh"]').forEach(
    (b) => (b.disabled = locked || !files.length),
  );
  $$(
    '[data-action="import"],[data-action="import-folder"],[data-action="demo"]',
  ).forEach((b) => (b.disabled = locked));
  $("#select-all").disabled = busy || !files.length;
  $$('[data-preview-action="save"]').forEach(
    (b) => (b.disabled = locked || !previewTargets().some((p) => drafts[p])),
  );
  $$('[data-preview-action="match"],[data-preview-action="extract-lyrics"],[data-preview-action="clear-all-tags"]').forEach(b => b.disabled = locked || (b.dataset.previewAction === 'clear-all-tags' && selected.size > 1));
  $$('[data-action="extract-lyrics"]').forEach(b => { b.disabled = locked; });
  const empty = !current(active);
  $('#preview-card').dataset.empty = String(empty);
  $('#preview-card').querySelectorAll('[data-tag]').forEach(element => { element.disabled = empty; });
  if (empty) $('#preview-card').querySelectorAll('[data-preview-action]').forEach(button => { button.disabled = button.dataset.previewAction === 'extract-lyrics' ? locked : true; });
  else $$('[data-preview-action="discard"]').forEach(button => { button.disabled = locked || !previewTargets().some(p => drafts[p]); });
}
function render() {
  renderCounts();
  renderGrid();
  renderPreview();
  updateBackupHint();
  updateButtons();
}
function pick(p, event = {}) {
  if (busy) return;
  if (event.shiftKey && active) {
    const list = visibleFiles().map((f) => f.path),
      a = list.indexOf(active),
      b = list.indexOf(p);
    if (a >= 0 && b >= 0) {
      selected = new Set(list.slice(Math.min(a, b), Math.max(a, b) + 1));
    }
  } else if (event.ctrlKey || event.metaKey) {
    selected.has(p) ? selected.delete(p) : selected.add(p);
  } else selected = new Set([p]);
  active = selected.has(p) ? p : [...selected].at(-1) || files[0]?.path || null;
  previewTab = "tags";
  render();
}
function consensus(field) {
  const values = [...selected].map((p) => String(tags(p)[field] || ""));
  return new Set(values).size === 1 ? values[0] : "";
}
function fieldHtml(key, wide = false) {
  const multi = selected.size > 1;
  const value = multi ? consensus(key) : tags(active)[key] || "";
  const different =
    multi &&
    new Set([...selected].map((p) => String(tags(p)[key] || ""))).size > 1;
  const changed = previewTargets().some(
    (p) => drafts[p]?.tags && Object.hasOwn(drafts[p].tags, key),
  );
  return `<label class="field ${wide ? "wide" : ""}"><span>${FIELDS[key]}${changed ? "<small>草稿</small>" : ""}</span><${key === "comment" ? "textarea" : "input"} data-tag="${key}" class="${changed ? "changed" : ""}" placeholder="${different ? "多个不同值，输入后统一修改" : "未填写"}" ${key === "comment" ? "" : `value="${esc(value)}"`}>${key === "comment" ? esc(value) + "</textarea>" : ""}</label>`;
}
function renderPreview() {
  const card = $("#preview-card");
  card.hidden = false;
  if (!active || !current(active)) active = files[0]?.path || null;
  const empty = !active;
  const f = current(active) || {path: '', filename: '—', format: '—'},
    t = tags(active),
    multi = selected.size > 1;
  const changed = previewTargets().filter((p) => drafts[p]).length;
  card.innerHTML = `<div class="preview-heading"><span>${icon(multi ? "grid" : "info")}${multi ? "批量预览" : "音频预览"} <span class="muted">/ ${multi ? selected.size + " 首" : f.format}</span></span><button class="icon-button" data-preview-action="close" aria-label="取消多选，预览第一首音频" title="取消多选，预览第一首音频">${icon("close")}</button></div><div class="preview-content"><div class="preview-art">${artwork(cover(active), "所选音频封面", false)}<button class="cover-edit" data-preview-action="cover">${icon("image")}更换封面${multi ? " · 全部" : ""}</button></div><h2 class="preview-title">${esc(multi ? `已选择 ${selected.size} 首音频` : t.title || f.filename)}</h2><p class="preview-subtitle">${esc(multi ? "修改的字段会应用到全部所选音频" : t.artist || "未知艺术家")}</p><div class="media-details"><span>${esc(f.format)}</span><span>${duration(f.duration)}</span><span>${f.sampleRate ? (f.sampleRate / 1000).toFixed(1) + " kHz" : "—"}</span><span>${f.bitrate ? Math.round(f.bitrate / 1000) + " kbps" : size(f.size)}</span></div><div class="preview-quick-actions"><button class="button primary" data-preview-action="match">${icon("sparkle")}${multi ? "批量补全" : "补全信息"}</button><button class="button secondary" data-preview-action="play" ${multi ? "disabled" : ""}>${icon(playing && playing === active ? "pause" : "play")}试听</button></div><button class="button secondary lyric-preview-entry" data-preview-action="extract-lyrics">${icon("lyrics")}${multi ? "批量提取歌词" : "提取歌词 · 默认 SRT"}</button><div class="preview-tabs" role="tablist">${[["tags", "可编辑信息"], ["lyrics", "歌词"], ["file", "文件详情"], ...(matches[active]?.length ? [["matches", "匹配结果"]] : [])].map(([key, label]) => `<button role="tab" aria-selected="${previewTab === key}" class="${previewTab === key ? "active" : ""}" data-tab="${key}">${label}</button>`).join("")}</div><div id="preview-panel">${previewTab === "tags" ? `${multi ? '<div class="batch-note">只会写入你实际修改的字段。不同值显示为空，保留不操作即可。</div>' : ""}<div class="field-grid">${["title", "artist", "album", "albumArtist"].map((k) => fieldHtml(k, true)).join("")}${["year", "genre", "track", "disc", "composer", "lyricist"].map((k) => fieldHtml(k)).join("")}${fieldHtml("comment", true)}</div>` : previewTab === "lyrics" ? `<div class="mini-actions"><button class="button secondary" data-preview-action="import-lyrics">导入 LRC / TXT</button><button class="button secondary" data-preview-action="lyrics-tools">整理歌词</button></div><label class="field"><span>内嵌歌词${multi ? " · 修改后应用到所选" : ""}</span><textarea class="lyrics-editor" data-tag="lyrics" placeholder="粘贴歌词，或通过补全信息联网获取">${esc(multi ? consensus("lyrics") : t.lyrics || "")}</textarea></label><p class="field-hint">支持带时间标签的 LRC 与纯文本歌词。编辑先暂存为草稿。</p>` : previewTab === "file" ? `<dl class="file-details"><dt>文件名称</dt><dd>${esc(f.filename)}</dd><dt>完整路径</dt><dd>${esc(f.path)}</dd><dt>格式 / 文件大小</dt><dd>${esc(f.format)} / ${size(f.size)}</dd><dt>时长 / 采样率 / 码率</dt><dd>${duration(f.duration)} / ${f.sampleRate || "—"} Hz / ${f.bitrate ? Math.round(f.bitrate / 1000) : "—"} kbps</dd><dt>声道 / 位深</dt><dd>${f.channels || "—"} / ${f.bitsPerSample || "—"} bit</dd><dt>修改时间</dt><dd>${f.modifiedAt ? esc(new Date(f.modifiedAt).toLocaleString("zh-CN")) : "—"}</dd><dt>封面与歌词</dt><dd>${cover(active) ? "已含封面" : "尚无封面"} · ${t.lyrics ? "已有歌词" : "尚无歌词"}</dd></dl><button class="button secondary" data-preview-action="locate">${icon("folder")}在资源管理器中显示</button>` : `<div class="preview-matches">${(matches[active] || []).map((c, i) => candidateHtml(c, i, true)).join("")}</div>`}</div></div><div class="preview-footer"><button class="button primary" data-preview-action="save" ${!changed || busy ? "disabled" : ""}>${icon("save")}${changed ? `写入${multi ? changed + " 首" : "此音频"}的修改` : "尚无待写入修改"}</button><div class="preview-footer-actions"><div class="preview-footer-links"><button class="clear-all-tags-link" data-preview-action="clear-all-tags" ${multi ? 'disabled title="请只选择一首音频"' : ''}>删除所有条目</button><button class="discard-draft-link" data-preview-action="discard">撤销所选草稿</button></div><span class="backup-hint" ${settings.backupEnabled ? '' : 'hidden'}>写入前自动备份</span></div></div>`;
  if (empty) {
    card.querySelectorAll('.media-details span,.file-details dd,.preview-title,.preview-subtitle').forEach(element => { element.textContent = '—'; });
    card.querySelectorAll('[data-tag]').forEach(element => { element.value = ''; element.placeholder = '—'; });
  }
  updateBackupHint();
  updateButtons();
}
async function addResult(result) {
  const existing = new Set(files.map((f) => f.path));
  let count = 0;
  for (const f of result.files || []) {
    if (!existing.has(f.path)) {
      appendRecord(f);
      existing.add(f.path);
      count++;
    }
  }
  if (count) {
    active = files[0]?.path || null;
    selected = active ? new Set([active]) : new Set();
    filter = "all";
    updateNav();
  }
  persist();
  render();
  status(
    `已导入 ${count} 首音频${result.errors?.length ? "，部分文件读取失败" : ""}`,
  );
  if (result.errors?.length)
    report(
      "导入完成",
      result.errors,
      `${count} 首已加入队列。重复文件自动跳过。`,
    );
}
async function importFiles(folder = false) {
  await run(
    async () => addResult(await api("choose-import", folder)),
    "正在读取音频标签与封面…",
  );
}
async function refreshAll(silent = false, operationId = "") {
  const r = await api(
    "refresh",
    files.map((f) => f.path),
    { operationId },
  );
  const records = new Map(r.files.map((f) => [f.path, f]));
  files = files.map((f) => records.get(f.path) || f);
  persist();
  render();
  if (r.errors?.length && !silent)
    report("部分文件刷新失败", r.errors, "成功读取的音频与封面已刷新。");
  else if (!silent) toast(r.canceled ? `刷新已停止，已读取 ${r.files.length} 首` : "全部音频的封面与标签已刷新");
  return r;
}
function removeQueue(all) {
  if (busy || backgroundTask) return;
  const paths = all ? new Set(files.map((f) => f.path)) : new Set(selected);
  if (!paths.size) return;
  undoQueue = {
    files: [...files],
    drafts: structuredClone(drafts),
    done: new Set(done),
    selected: new Set(selected),
    active,
  };
  files = files.filter((f) => !paths.has(f.path));
  for (const p of paths) {
    delete drafts[p];
    done.delete(p);
    delete matches[p];
  }
  selected = new Set([...selected].filter((p) => !paths.has(p)));
  active = [...selected].at(-1) || files[0]?.path || null;
  if (batchSession) {
    batchSession.items = batchSession.items.filter(item => current(item.path));
    if (!batchSession.items.length) batchSession = null;
    renderBackgroundTask();
  }
  persist();
  render();
  toast(
    all
      ? "已清空操作队列，原文件未改动"
      : `已移除 ${paths.size} 首，原文件未改动`,
    "",
    {
      label: "撤回",
      run: () => {
        if (!undoQueue) return;
        ({ files, drafts, done, selected, active } = undoQueue);
        undoQueue = null;
        persist();
        render();
      },
    },
  );
}
function modal(title, body, footer = "", eyebrow = "MUSIC TOOLS") {
  const d = $("#modal");
  $("#modal-title").textContent = title;
  $("#modal-eyebrow").textContent = eyebrow;
  $("#modal-body").innerHTML = body;
  $("#modal-footer").innerHTML = footer;
  if (!d.open) d.showModal();
  hydrate(d);
}
function report(title, errors, intro = "") {
  modal(
    title,
    `<p class="modal-description">${esc(intro)}</p>${errors.map((e) => `<div class="inline-status"><strong>${esc(basename(e.path || e.source || "详情"))}</strong><br>${esc(e.message || e.error || JSON.stringify(e))}${e.code ? " · " + esc(e.code) : ""}</div>`).join("")}`,
    `<button class="button primary" data-modal-action="close">知道了</button>`,
  );
}
async function clearAllTags() {
  if (selected.size > 1 || !active) return;
  const p = active, record = current(p);
  await run(async () => {
    const result = await api('clear-tags', [{ path: p, stamp: record.stamp }]);
    for (const item of result.results || []) {
      const index = files.findIndex(f => f.path === item.path);
      if (index >= 0 && item.record) replaceRecord(index, item.record);
      delete drafts[item.path]; delete matches[item.path]; done.delete(item.path);
    }
    persist(); render();
    if (result.errors?.length) report('清空未完成', result.errors, '文件未能清空，请处理原因后重试。');
    else { toast('已删除此音频的全部标签与封面'); status('已清空标签与图片，文件名、格式和文件时间已保留。'); }
  }, settings.backupEnabled ? '正在备份并清空此音频的全部标签…' : '正在清空此音频的全部标签…');
}
async function writeFiles(paths) {
  const jobs = paths
    .filter((p) => drafts[p])
    .map((p) => ({ path: p, ...drafts[p], stamp: current(p)?.stamp }));
  if (!jobs.length) return;
  await run(async () => {
    const r = await api("write", jobs, {});
    for (const item of r.results) {
      delete drafts[item.path];
      done.add(item.path);
      if (item.record) {
        const i = files.findIndex((f) => f.path === item.path);
        if (i >= 0) replaceRecord(i, item.record);
      }
    }
    await refreshAll(true);
    status(
      `已写入 ${r.results.length} 首，全部封面已刷新${r.errors.length ? " · " + r.errors.length + " 首未完成" : ""}`,
    );
    if (r.errors.length)
      report(
        "写入结果",
        r.errors,
        `${r.results.length} 首成功；失败项保留草稿，请处理原因后重试。`,
      );
    else toast(`${r.results.length} 首写入完成，已统一刷新全部封面`);
  }, settings.backupEnabled ? "正在写入音频，已有标签会自动备份…" : "正在写入音频，自动备份已关闭…");
}
function providerOptions() {
  return `<fieldset class="provider-picker"><legend>搜索平台 <span>同等匹配优先 QQ 音乐</span></legend><div class="provider-options">${PLATFORM_ORDER.map((s) => `<label><input type="checkbox" data-source="${s}" ${settings.sources.includes(s) ? "checked" : ""}>${sources[s]}</label>`).join("")}</div></fieldset>`;
}
function chosenSources() {
  return $("[data-source]")
    ? PLATFORM_ORDER.filter((key) => $(`[data-source="${key}"]`)?.checked)
    : [...settings.sources];
}
function policyOptionsHtml() {
  return `<details class="sync-policy" open><summary>同步字段与覆盖规则 <span id="policy-summary"></span></summary><p class="field-hint" id="policy-help">只查询和同步勾选的信息；覆盖未勾选时仅补空缺，已有手动草稿也会保留。来源未提供内容时保留当前值。</p><div class="policy-tools"><div class="mini-actions"><button type="button" class="button secondary" data-policy-preset="all">全选</button><button type="button" class="button secondary" data-policy-preset="none">清空</button><button type="button" class="button secondary" data-policy-preset="album">只选封面+作者+专辑</button></div><label class="policy-overwrite-all"><input type="checkbox" data-policy-all-overwrite>覆盖所选字段</label></div><table class="policy-table" aria-label="逐字段同步和覆盖规则" aria-describedby="policy-help"><thead><tr><th scope="col">同步</th><th scope="col">信息</th><th scope="col">覆盖</th></tr></thead><tbody>${Object.entries(SYNC_FIELDS).map(([key,label])=>`<tr><td><label class="policy-toggle"><input id="policy-${key}" type="checkbox" data-policy-field="${key}" aria-label="同步${label}" ${settings.fields.includes(key)?'checked':''}></label></td><th scope="row"><label for="policy-${key}">${label}</label></th><td><label class="policy-toggle"><input type="checkbox" data-policy-overwrite="${key}" aria-label="覆盖已有${label}" ${settings.overwriteFields.includes(key)?'checked':''}></label></td></tr>`).join('')}</tbody></table><p id="policy-empty" class="policy-empty" role="status" aria-live="polite" hidden>尚未选择同步信息。请勾选字段后再搜索，不会发送联网请求。</p><p class="field-hint policy-lock-note" hidden>本次搜索规则已锁定。更改默认设置将在下次补全时生效。</p></details>`;
}
function completionOptions() {
  const fields = $("[data-policy-field]")
    ? $$('[data-policy-field]:checked').map((el) => el.dataset.policyField)
    : [...settings.fields];
  const overwriteFields = $("[data-policy-overwrite]")
    ? $$('[data-policy-overwrite]:checked').map((el) => el.dataset.policyOverwrite).filter((key) => fields.includes(key))
    : settings.overwriteFields.filter((key) => fields.includes(key));
  return { sources: chosenSources(), country: settings.country, fields, overwriteFields, fillOnly: overwriteFields.length === 0 };
}
function updatePolicySummary() {
  if (!$("[data-policy-field]")) return;
  const options = completionOptions();
  $('#policy-summary').textContent = `已选 ${options.fields.length} 项 · ${options.overwriteFields.length} 项覆盖`;
  $('#policy-empty').hidden = options.fields.length > 0;
  const all = $('[data-policy-all-overwrite]');
  all.checked = options.fields.length > 0 && options.fields.every((key) => options.overwriteFields.includes(key));
  all.indeterminate = options.overwriteFields.length > 0 && !all.checked;
  all.disabled = !options.fields.length;
  $$('[data-policy-overwrite]').forEach((el) => { el.disabled = !options.fields.includes(el.dataset.policyOverwrite); });
}
function bindPolicyControls(onChange, saveImmediately = true) {
  const changed = () => {
    updatePolicySummary();
    if (saveImmediately) {
      const options = completionOptions();
      settings = { ...settings, sources: options.sources, fields: options.fields,
        overwriteFields: $$('[data-policy-overwrite]:checked').map((el) => el.dataset.policyOverwrite) };
      persistSettings();
    }
    onChange?.();
  };
  $$('[data-source], [data-policy-field], [data-policy-overwrite]').forEach((el) => { el.onchange = changed; });
  $$('[data-policy-preset]').forEach((button) => { button.onclick = () => {
    const preset = button.dataset.policyPreset;
    $$('[data-policy-field]').forEach((el) => { el.checked = preset === 'all' || preset === 'album' && ['cover','artist','album'].includes(el.dataset.policyField); });
    changed();
  }; });
  $('[data-policy-all-overwrite]').onchange = (event) => {
    $$('[data-policy-overwrite]').forEach((el) => { if (!el.disabled) el.checked = event.target.checked; });
    changed();
  };
  updatePolicySummary();
}
function lockPolicyControls() {
  $$('[data-source], [data-policy-field], [data-policy-overwrite], [data-policy-preset], [data-policy-all-overwrite]').forEach((el) => { el.disabled = true; });
  const detail = $('.sync-policy');
  if (detail) detail.open = false;
  const note = $('.policy-lock-note');
  if (note) note.hidden = false;
}
function canComplete(options, target) {
  const message = !options.fields.length ? '请先选择要同步的信息，再开始搜索。' : !options.sources.length ? '请至少选择一个搜索平台。' : '';
  if (!message) return true;
  if (target) target.innerHTML = `<div class="inline-status" role="status">${esc(message)}未发送联网请求。</div>`;
  else toast(message);
  return false;
}
function effectiveSyncFields(p, options) {
  const fields = Array.isArray(options?.fields) ? options.fields : Object.keys(SYNC_FIELDS);
  const overwrite = Array.isArray(options?.overwriteFields) ? options.overwriteFields : options?.fillOnly === false ? fields : [];
  const local = tags(p);
  return fields.filter((key) => Object.hasOwn(SYNC_FIELDS, key) &&
    (overwrite.includes(key) || !hasValue(key === 'cover' ? cover(p) : local[key])));
}
function syncPatch(p, remote, options, accepted = options.fields) {
  const allowed = effectiveSyncFields(p, options).filter((key) => accepted.includes(key));
  const updates = {};
  for (const key of allowed) if (key !== 'cover' && hasValue(remote[key])) updates[key] = String(remote[key]);
  return { tags: updates, useCover: allowed.includes('cover') };
}
function localMeta(p) {
  return {
    ...tags(p),
    cover: cover(p),
    duration: current(p)?.duration,
    filename: current(p)?.filename,
  };
}
function searchQuery(p, options = settings) {
  const t = tags(p), fields = options.fields || Object.keys(SYNC_FIELDS);
  return [fields.includes('artist') ? t.artist : '', fields.includes('title') && t.title || current(p)?.filename.replace(/\.[^.]+$/, "")]
    .filter(Boolean)
    .join(" ");
}
function candidateHtml(c, i, compact = false) {
  return `<div class="match-item">${c.coverUrl ? `<img src="${esc(c.coverUrl)}" alt="候选封面" loading="lazy">` : '<div class="match-cover"></div>'}<div class="match-copy"><strong>${esc(c.title)}</strong><p>${esc(c.artist)}<br>${esc(c.album || "未提供专辑")} ${c.year ? " · " + esc(c.year) : ""}</p><span class="source-badge">${esc(sources[c.source] || c.source)}</span><span class="match-score">相似度 ${c.score ?? "—"}%</span></div><div class="match-actions"><button class="button secondary" ${compact ? `data-candidate="${i}"` : `data-match-index="${i}"`}>选择并预览</button></div></div>`;
}
let searchTarget = null,
  searchCandidates = [],
  searchPolicy = null,
  searchGeneration = 0;
const matchPolicies = {};
async function openMatch(p = active) {
  if (busy || backgroundTask) { toast('请先完成或停止当前任务'); return; }
  if (!p) return;
  if (selected.size > 1) return batchMatch();
  searchTarget = p;
  searchCandidates = [];
  modal(
    "补全这首音频",
    `<p class="modal-description">搜索标签、封面与歌词。选中结果后，逐项确认要加入草稿的信息。</p><form id="match-form" class="modal-search"><input class="form-input" id="match-query" aria-label="联网搜索关键词" value="${esc(searchQuery(p))}"><button class="button primary" type="submit">${icon("search")}搜索</button></form>${providerOptions()}${policyOptionsHtml()}<div id="match-results"><div class="inline-status">准备搜索…</div></div>`,
    `<button class="button secondary" data-modal-action="cancel-search">停止搜索</button>`,
    `SINGLE TRACK / ${current(p).format}`,
  );
  $('#match-query').dataset.autoQuery = $('#match-query').value;
  bindPolicyControls(() => {
    const input = $('#match-query');
    if (input.value === input.dataset.autoQuery) input.value = searchQuery(p, completionOptions());
    input.dataset.autoQuery = searchQuery(p, completionOptions());
    searchGeneration++;
    searchCandidates = [];
    delete matches[p];
    delete matchPolicies[p];
    $('#match-results').innerHTML = '<div class="inline-status" role="status">规则已更新，点击搜索以获取符合当前选择的候选。</div>';
    renderPreview();
  });
  $("#match-form").onsubmit = (e) => {
    e.preventDefault();
    doSearch();
  };
  await doSearch();
}
async function doSearch() {
  const input = $("#match-query");
  if (!input) return;
  const value = input.value.trim();
  if (!value) {
    toast("请填写歌曲或艺术家关键词");
    return;
  }
  const results = $("#match-results"),
    button = $("#match-form button"),
    options = completionOptions(),
    generation = ++searchGeneration;
  if (!canComplete(options, results)) return;
  searchPolicy = structuredClone(options);
  button.disabled = true;
  results.innerHTML =
    '<div class="inline-status"><span class="busy-indicator"></span>正在查询音乐来源…</div>';
  try {
    const r = await api("search", value, {
      ...options,
      local: localMeta(searchTarget),
      limit: 10,
    });
    if (!results.isConnected || generation !== searchGeneration) return;
    searchCandidates = r.candidates;
    matches[searchTarget] = r.candidates;
    matchPolicies[searchTarget] = structuredClone(options);
    results.innerHTML = `<div class="field-hint">${r.candidates.length} 个候选 · 相似度用于辅助筛选，请核对原唱与版本。</div>${r.candidates.map((c, i) => candidateHtml(c, i)).join("") || '<div class="inline-status">未找到匹配结果。可缩短关键词或切换来源后重试。</div>'}${r.errors.length ? `<details class="result-errors"><summary>${r.errors.length} 个来源提示</summary>${r.errors.map((e) => esc(sources[e.source] || e.source) + ": " + esc(e.message)).join("<br>")}</details>` : ""}`;
    renderPreview();
  } catch (e) {
    if (results.isConnected)
      results.innerHTML = `<div class="inline-status">${esc(e.message.includes("cancel") ? "搜索已停止" : e.message)}</div>`;
  } finally {
    if (button.isConnected) button.disabled = false;
  }
}
let reviewPayload = null;
async function candidateReview(candidate, p) {
  if (busy || backgroundTask) { toast('请先完成或停止当前任务'); return; }
  const policy = structuredClone(matchPolicies[p] || completionOptions());
  if (!candidate || !canComplete(policy)) return;
  const eligible = effectiveSyncFields(p, policy);
  modal(
    "正在获取详细信息",
    `<div class="inline-status"><span class="busy-indicator"></span>获取标签、高清封面与歌词，请稍候…</div>`,
    `<button class="button secondary" data-modal-action="close">关闭</button>`,
  );
  try {
    const enriched = await api("enrich", candidate, {
      ...policy, local: localMeta(p), artwork: eligible.includes('cover'), lyrics: eligible.includes('lyrics'),
    });
    if (!$("#modal").open) return;
    reviewPayload = { p, candidate, enriched, policy };
    const t = tags(p);
    const allowed = effectiveSyncFields(p, policy);
    const proposed = Object.entries(FIELDS).filter(
      ([k]) => policy.fields.includes(k) && hasValue(enriched[k]),
    );
    modal(
      "核对补全信息",
      `<p class="modal-description">${esc(candidate.title)} · ${esc(candidate.artist)}<br>本次只同步已选 ${policy.fields.length} 项；覆盖未开启的已有信息会保留。可取消采用单项结果。</p><table class="detail-table"><thead><tr><th>采用</th><th>字段 / 当前</th><th>联网结果</th></tr></thead><tbody>${proposed.map(([k, label]) => `<tr><td><input type="checkbox" data-review-field="${k}" aria-label="采用${label}" ${allowed.includes(k) ? "checked" : 'disabled title="已填写，当前规则仅补空缺"'}></td><td>${label}<br><span class="muted">${esc(String(t[k] || "未填写").slice(0, 80))}</span></td><td>${esc(String(enriched[k]).slice(0, k === "lyrics" ? 140 : 180))}${k === "lyrics" ? "…" : ""}</td></tr>`).join("")}${policy.fields.includes('cover') && enriched.coverUrl ? `<tr><td><input type="checkbox" data-review-cover aria-label="采用封面" ${allowed.includes('cover') ? "checked" : 'disabled title="已有封面，当前规则仅补空缺"'}></td><td>封面<br><span class="muted">${cover(p) ? "已有封面" : "尚无封面"}</span></td><td><img src="${esc(enriched.coverUrl)}" alt="候选封面预览" width="100" height="100"></td></tr>` : ""}</tbody></table>${policy.fields.includes('lyrics')&&allowed.includes('lyrics')&&enriched.translatedLyrics?`<label class="field"><span>此来源提供翻译歌词 · 排版方式</span><select id="review-lyrics-layout"><option value="original">只保留原文</option><option value="interleaved">原文与译文上下排列</option><option value="inline">原文与译文同一行</option><option value="translation">只保留译文</option></select></label>`:''}${enriched.errors?.length ? `<details class="result-errors"><summary>部分内容未获取</summary>${enriched.errors.map((e) => esc(sources[e.source] || e.source) + ": " + esc(e.message)).join("<br>")}</details>` : ""}`,
      `<button class="button secondary" data-modal-action="close">取消</button><button class="button primary" data-modal-action="apply-review">加入草稿</button>`,
      "REVIEW BEFORE APPLYING",
    );
  } catch (e) {
    report("获取失败", [{ message: e.message }]);
  }
}
async function applyReview() {
  if (!reviewPayload) return;
  const { p, enriched, policy } = reviewPayload;
  const accepted = $$('[data-review-field]:checked').map((el) => el.dataset.reviewField);
  if ($('[data-review-cover]')?.checked) accepted.push('cover');
  const planned = syncPatch(p, enriched, policy, accepted);
  const patchTags = planned.tags;
  const useCover = planned.useCover && hasValue(enriched.coverUrl);
  const button = $('[data-modal-action="apply-review"]');
  button.disabled = true;
  button.textContent = "正在应用…";
  try {
    const layout=$('#review-lyrics-layout')?.value;
    if(patchTags.lyrics&&enriched.translatedLyrics&&layout&&layout!=='original'){
      const [result]=await api('text-tools','lyrics',[{path:p,tags:{lyrics:patchTags.lyrics}}],{translatedLyrics:enriched.translatedLyrics,layout});
      if(result.error)throw new Error(result.error);
      patchTags.lyrics=result.tags.lyrics;
    }
    let value;
    if (useCover) value = await api("download-cover", enriched.coverUrl);
    const filtered = await api('sync-filter', p, { tags: patchTags, ...(hasValue(value) ? { cover: value } : {}) }, policy, localMeta(p));
    // Recheck current merged drafts after downloads and server validation.
    const final = syncPatch(p, filtered.tags || {}, policy, accepted);
    patch([p], final.tags, final.useCover && hasValue(filtered.cover) ? filtered.cover : undefined);
    selected = new Set([p]);
    active = p;
    previewTab = "tags";
    render();
    $("#modal").close();
    toast("所选信息已加入草稿，确认后点击写入");
  } catch (e) {
    toast(e.message, "error");
    button.disabled = false;
    button.textContent = "重试加入草稿";
  }
}
let batchSession = null;
function batchRowHtml(item, index) {
  const c = item.candidates[item.choice], local = localMeta(item.path);
  const delta = c?.duration && local.duration ? `${(c.duration-local.duration)>=0?'+':''}${(c.duration-local.duration).toFixed(2)} 秒` : '时长未知';
  return `<article class="batch-row" data-batch-row="${index}" data-state="${item.staged?'staged':item.error?'error':!c?'empty':item.recommended?'ready':'review'}"><label class="batch-check"><input type="checkbox" data-batch-check="${index}" aria-label="确认采用 ${esc(basename(item.path))}" ${item.checked?'checked':''} ${!c||item.staged?'disabled':''}></label><div class="batch-row-content"><strong>${esc(basename(item.path))}</strong><p class="field-hint">本地 ${duration(local.duration)} · ${item.staged?'已加入草稿':item.recommended?'符合预选条件':'请核对同名作品和发行版本'}</p>${c?`<select class="form-input" data-batch-choice="${index}" aria-label="${esc(basename(item.path))} 的匹配候选" ${item.staged?'disabled':''}>${item.candidates.map((v,i)=>`<option value="${i}" ${i===item.choice?'selected':''}>${esc(v.title)} / ${esc(v.artist)} · ${esc(v.album||'未提供专辑')} · ${duration(v.duration)} · ${v.score}% · ${esc(sources[v.source]||v.source)}</option>`).join('')}</select><p class="batch-evidence"><span>候选 ${duration(c.duration)}</span><span>差 ${delta}</span><span>相似度 ${c.score}%</span></p><details><summary>查看当前与候选差异</summary><table class="detail-table"><tbody>${batchSession.options.fields.map(k=>`<tr><th>${SYNC_FIELDS[k]}</th><td>${esc(k==='cover'?(cover(item.path)?'已有封面':'尚无封面'):String(tags(item.path)[k]||'未填写').slice(0,100))}</td><td>→ ${esc(k==='cover'?(c.coverUrl?'候选提供封面':'详情获取时确认'):String(c[k]||'来源未提供').slice(0,100))}<br><span class="muted">${batchSession.options.overwriteFields.includes(k)?'有结果时覆盖':effectiveSyncFields(item.path,batchSession.options).includes(k)?'仅补空缺':'保留已有值'}</span></td></tr>`).join('')}</tbody></table><p class="field-hint">同一录音可能属于不同专辑、再版或合辑。采用前请核对发行版本。</p></details>`:'<p>未找到候选，可更换关键词后重试。</p>'}<div class="batch-retry"><input class="form-input" data-batch-query="${index}" aria-label="修改 ${esc(basename(item.path))} 搜索词" value="${esc(item.query)}"><button class="button secondary" data-batch-retry="${index}" ${item.staged?'disabled':''}>重试</button></div>${item.error?`<p role="status">${esc(item.error)}</p>`:''}${item.errors?.length?`<details class="result-errors"><summary>${item.errors.length} 个来源提示</summary>${item.errors.map(e=>esc(sources[e.source]||e.source||'来源')+': '+esc(e.message||e.error)).join('<br>')}</details>`:''}</div></article>`;
}
function renderBatchRows() {
  if (!batchSession || !$('#batch-results')) return;
  $('#batch-results').innerHTML = batchSession.items.map(batchRowHtml).join('');
  $('#batch-results').onchange = e => {
    const check=e.target.dataset.batchCheck, choice=e.target.dataset.batchChoice;
    if(check!==undefined)batchSession.items[Number(check)].checked=e.target.checked;
    if(choice!==undefined){const item=batchSession.items[Number(choice)];item.choice=Number(e.target.value);item.checked=false;item.recommended=false;renderBatchRows();}
    updateBatchSelection();
  };
  $('#batch-results').onclick = async e => {
    const button=e.target.closest('[data-batch-retry]');if(!button)return;
    const index=Number(button.dataset.batchRetry),item=batchSession.items[index];
    const value=$(`[data-batch-query="${index}"]`).value.trim();if(!value)return;
    button.disabled=true;
    try{const r=await api('search',value,{...batchSession.options,local:localMeta(item.path),limit:8});item.query=value;item.candidates=r.candidates;item.errors=r.errors;item.error='';item.choice=0;item.checked=false;item.recommended=false;matches[item.path]=r.candidates;}
    catch(e){item.error=e.message;}
    renderBatchRows();updateBatchSelection();
  };
  updateBatchSelection();
}
function updateBatchSelection(){
  if(!batchSession)return;
  const count=batchSession.items.filter(i=>i.checked&&!i.staged&&i.candidates[i.choice]).length;
  const button=$('#apply-batch');if(button){button.disabled=!count||busy||!!backgroundTask;button.textContent=`采用已勾选的 ${count} 首 → 草稿`;}
  const mode=$('#batch-filter')?.value||'all';
  $$('[data-batch-row]').forEach(row=>row.hidden=mode!=='all'&&row.dataset.state!==mode);
  if($('#batch-summary'))$('#batch-summary').textContent=`${batchSession.items.length} 首已搜索 · ${count} 首已勾选 · ${batchSession.items.filter(i=>i.staged).length} 首已生成草稿`;
}
async function batchMatch() {
  const paths=[...selected];if(!paths.length){toast('请先选中要补全的音频');return;}
  if(paths.length===1)return openMatch(paths[0]);if(busy||backgroundTask)return;
  batchSession=null;
  modal(`批量补全 ${paths.length} 首`,`<p class="modal-description">先搜索、逐首核对候选并勾选，再生成草稿。仅文件名不能证明录音身份；未勾选的项目保持原样。</p>${providerOptions()}${policyOptionsHtml()}<div class="inline-status" id="batch-progress" role="status" aria-live="polite">准备搜索 ${paths.length} 首音频</div><div class="progress"><div id="batch-progress-bar"></div></div><div id="batch-toolbar" hidden><span id="batch-summary"></span><div class="mini-actions"><select id="batch-filter" class="form-input" aria-label="筛选匹配状态"><option value="all">全部结果</option><option value="ready">符合预选条件</option><option value="review">待核对</option><option value="empty">无结果</option><option value="error">失败</option><option value="staged">已生成草稿</option></select><button class="button secondary" id="batch-select-all">勾选所有有候选项</button><button class="button secondary" id="batch-unselect">取消勾选</button></div></div><div id="batch-results"></div>`,`<button class="button secondary" data-modal-action="background-task">后台继续</button><button class="button secondary" data-modal-action="cancel-search">停止任务</button><button class="button primary" id="start-batch">开始匹配</button>`,'BATCH MATCH / REVIEW FIRST');
  bindPolicyControls();
  $('#start-batch').onclick=()=>{
    const options=structuredClone({...completionOptions(),limit:50});
    if(!canComplete(options,$('#batch-progress')))return;
    return runBackground('match',paths.length,async operationId=>{
    $('#start-batch').disabled=true;
    lockPolicyControls();
    // Freeze field and provider choices for search, retries, and staging.
    const policy={...structuredClone(options),threshold:settings.threshold};
    batchSession={options,policy,pending:'match',canceled:false,items:[]};
    const r=await api('batch-match',paths.map(p=>({path:p,query:searchQuery(p),local:localMeta(p)})),{...options,operationId});
    const byPath=new Map(r.results.map(item=>[item.path,item]));
    batchSession={options,policy,pending:false,canceled:r.canceled,items:paths.map(p=>{const item=byPath.get(p),error=r.errors.find(e=>e.path===p);const recommended=item?.recommendedIndex===0&&item?.candidates[0]?.score>=policy.threshold;return {path:p,query:searchQuery(p),candidates:item?.candidates||[],errors:item?.errors||[],error:error?.error||(!item?'尚未搜索':''),choice:0,checked:recommended,recommended,staged:false};})};
    for(const item of batchSession.items){matches[item.path]=item.candidates;matchPolicies[item.path]=structuredClone(options);}
    if($('#batch-results') && $('#modal').open) finishBatchView();
    else toast(r.canceled?'匹配已停止，已完成的结果已保留':'匹配已完成，可查看并核对候选','',{label:'查看结果',run:showBatchResults});
    renderPreview();updateButtons();status('匹配已完成，请逐首核对并勾选。');
  }).finally(updateBatchSelection);
  };
}
function batchToolbarHtml() {
  return '<div id="batch-toolbar"><span id="batch-summary"></span><div class="mini-actions"><select id="batch-filter" class="form-input" aria-label="筛选匹配状态"><option value="all">全部结果</option><option value="ready">符合预选条件</option><option value="review">待核对</option><option value="empty">无结果</option><option value="error">失败</option><option value="staged">已生成草稿</option></select><button class="button secondary" id="batch-select-all">勾选所有有候选项</button><button class="button secondary" id="batch-unselect">取消勾选</button></div></div>';
}
function finishBatchView() {
  if(!batchSession || !$('#batch-results'))return;
  $('#batch-progress').textContent=batchSession.message || ((batchSession.canceled?'已停止':'搜索完成')+'，'+batchSession.items.length+' 首结果已保留。核对后采用到草稿，再点击写入。');
  $('#batch-toolbar').hidden=false;
  $('#modal-footer').innerHTML='<button class="button secondary" data-modal-action="close">完成审核</button><button class="button primary" id="apply-batch">采用勾选项 → 草稿</button>';
  $('#apply-batch').onclick=()=>stageBatch();
  $('#batch-filter').onchange=updateBatchSelection;
  $('#batch-select-all').onclick=()=>{for(const item of batchSession.items)if(!item.staged&&item.candidates[item.choice])item.checked=true;renderBatchRows();};
  $('#batch-unselect').onclick=()=>{for(const item of batchSession.items)item.checked=false;renderBatchRows();};
  renderBatchRows();
}
function showBatchResults() {
  if(!batchSession)return;
  const pending=!!batchSession.pending;
  modal(pending?'批量补全正在进行':'批量补全 · 核对结果', '<p class="modal-description">'+(pending?'任务在后台继续，可收起窗口后浏览队列。':'候选结果已保留。勾选采用后只生成草稿，点击写入才会修改文件。')+'</p><div class="inline-status" id="batch-progress" role="status" aria-live="polite"></div><div class="progress"><div id="batch-progress-bar"></div></div>'+batchToolbarHtml()+'<div id="batch-results"></div>',pending?'<button class="button secondary" data-modal-action="background-task">后台继续</button><button class="button secondary" data-modal-action="cancel-search">停止任务</button>':'','BATCH MATCH / REVIEW FIRST');
  if(pending){$('#batch-toolbar').hidden=true;renderBackgroundTask();if(backgroundTask)$('#batch-progress').textContent='正在处理 '+backgroundTask.done+' / '+backgroundTask.total;}
  else finishBatchView();
}
async function stageBatch() {
  const session=batchSession;if(!session)return;
  // Freeze the reviewed candidate objects and policy before asynchronous enrichment.
  const targets=session.items.filter(i=>i.checked&&!i.staged&&i.candidates[i.choice]).map(i=>({item:i,candidate:{...i.candidates[i.choice]}}));
  if(!targets.length)return;
  await runBackground('stage',targets.length,async operationId=>{
    session.canceled=false;session.pending='stage';
    const accepted=structuredClone(session.options);let success=0;const warnings=[];
    $('#modal-footer').innerHTML='<button class="button secondary" data-modal-action="background-task">后台继续</button><button class="button secondary" id="stop-stage">停止获取，保留已有草稿</button>';
    $('#stop-stage').onclick=()=>{session.canceled=true;api('cancel-search').catch(()=>{});};
    $('#batch-toolbar').hidden=true;
    $$('[data-batch-check], [data-batch-choice], [data-batch-retry]').forEach(e=>e.disabled=true);
    const payload=targets.map(({item,candidate})=>({path:item.path,candidate,local:localMeta(item.path)}));
    const response=await api('batch-stage',payload,{...accepted,operationId}).catch(error=>({results:[],errors:payload.map(item=>({path:item.path,message:error.message})),canceled:session.canceled}));
    const targetMap=new Map(targets.map(({item})=>[item.path,item]));
    for(const result of response.results||[]){
      const item=targetMap.get(result.path);if(!item)continue;
      // Server returns only allowed patches; recheck against edits made during the request.
      const planned=syncPatch(item.path,result.tags||{},accepted);
      const image=planned.useCover&&hasValue(result.cover)?result.cover:undefined;
      patch([item.path],planned.tags,image,false);item.staged=true;item.checked=false;success++;
      if(result.errors?.length){item.errors.push(...result.errors);warnings.push(...result.errors.map(error=>({path:item.path,message:error.message||error.error})));}
    }
    for(const error of response.errors||[]){const item=targetMap.get(error.path);if(item)item.error=error.message||error.error;warnings.push(error);}
    session.canceled=session.canceled||response.canceled;session.pending=false;
    session.message=(session.canceled?'已停止，已有草稿保留':'获取完成')+' · 本次 '+success+' 首已加入草稿'+(warnings.length?' · '+warnings.length+' 条来源提示':'')+'。审核后点击主界面的写入。';
    render();
    if($('#batch-results') && $('#modal').open) finishBatchView();
    else toast(session.message,'',{label:'查看结果',run:showBatchResults});
    status('本次已为 '+success+' 首生成草稿，尚未写入。');
  });
  updateBatchSelection();
}

async function showHistory() {
  const items = await api("history");
  modal(
    "写入与恢复历史",
    `<p class="modal-description">备份开启时，已有标签的文件在写入、清空和重命名前会备份；空标签文件跳过备份。恢复仍会备份当前版本；外部改动的文件需先重新读取。</p>${items.length ? items.map((item) => `<div class="history-item"><span>${icon("history")}</span><div class="history-copy"><strong>${esc(basename(item.originalPath || item.path))}</strong><p>${esc(new Date(item.createdAt || item.time || Date.now()).toLocaleString("zh-CN"))} · ${esc({ write: "标签写入", rename: "文件重命名", restore: "恢复", clear: "清空全部标签" }[item.action] || item.action)} · ${esc(item.status)}</p></div><button class="button secondary" data-restore="${esc(item.id)}" ${!["complete", "committed"].includes(item.status) || item.restoredAt ? "disabled" : ""}>${item.restoredAt ? "已恢复" : "恢复此备份"}</button></div>`).join("") : '<div class="inline-status">还没有写入记录。开启备份后，已有标签文件的修改记录会显示在这里。</div>'}`,
    `<button class="button secondary" data-modal-action="open-data">打开备份目录</button><button class="button primary" data-modal-action="close">完成</button>`,
    "HISTORY / AUTOMATIC BACKUPS",
  );
}
async function restoreBackup(id) {
  await run(async () => {
    const r = await api("restore", id);
    const previous = r.previousPath || r.path;
    const old = files.find((f) => f.path === previous || f.path === r.path);
    if (old) replaceRecord(files.indexOf(old), r.record);
    else appendRecord(r.record);
    delete drafts[previous];
    delete drafts[r.path];
    done.delete(previous);
    done.delete(r.path);
    if (selected.has(previous)) {
      selected.delete(previous);
      selected.add(r.path);
    }
    if (active === previous) active = r.path;
    await api("import-paths", [r.path]);
    await refreshAll(true);
    await showHistory();
    toast("备份恢复成功，封面与标签已重新读取");
  }, "正在校验备份并恢复文件…");
}
let toolTab = "edit",
  toolPaths = [];
function tools(tab = "edit") {
  toolPaths = [...selected];
  if (!toolPaths.length) {
    toast("请先选择需要处理的音频");
    return;
  }
  toolTab = tab;
  renderTools();
}
function renderTools() {
  const tabs = [
    ["edit", "统一标签"],
    ["rename", "按标签重命名"],
    ["filename", "文件名转标签"],
    ["replace", "查找替换"],
    ["lyrics", "歌词整理"],
    ["chinese", "繁简转换"],
    ["clear", "清空标签"],
    ["export", "提取封面 / 歌词"],
  ];
  let body = "";
  if (toolTab === "edit")
    body = `<div class="tool-form">${Object.entries(FIELDS)
      .filter(([k]) => k !== "lyrics")
      .map(
        ([k, v]) =>
          `<div class="field"><label class="tool-field-toggle"><input type="checkbox" data-tool-field="${k}"><span>${v}</span></label><input data-tool-value="${k}" aria-label="${v}" placeholder="勾选后应用；留空将清除此字段"></div>`,
      )
      .join("")}</div>`;
  if (toolTab === "rename" || toolTab === "filename")
    body = `<label class="field"><span>${toolTab === "rename" ? "文件名模板" : "当前文件名的格式"}</span><input id="tool-pattern" value="{artist} - {title}"></label><p class="field-hint">可用：{title} {artist} {album} {albumArtist} {track} {disc} {year} {comment}${toolTab === "rename" ? "；{track:02} 补零；扩展名自动保留。只重命名音频，旁置文件保持原名。" : "。例如 艺术家 - 标题.mp3。"}</p>${toolTab === "filename" ? '<label class="check-grid"><input id="tool-regex" type="checkbox">使用正则表达式（命名捕获组）</label>' : ""}`;
  if (toolTab === "replace")
    body = `<div class="tool-form"><label class="field"><span>查找</span><input id="tool-find"></label><label class="field"><span>替换为</span><input id="tool-replace"></label></div><div class="check-grid">${["title", "artist", "album", "albumArtist", "comment", "lyrics"].map((k) => `<label><input type="checkbox" data-replace-field="${k}" ${k === "title" ? "checked" : ""}>${FIELDS[k]}</label>`).join("")}</div><div class="check-grid"><label><input type="checkbox" id="tool-regex">正则表达式</label><label><input type="checkbox" id="tool-case">区分大小写</label></div>`;
  if (toolTab === "lyrics")
    body = `<div class="check-grid"><label><input id="strip-times" type="checkbox">去除时间标签</label><label><input id="strip-metadata" type="checkbox">去除头信息</label><label><input id="remove-blank" type="checkbox">去除空行</label><label><input id="format-times" type="checkbox" checked>统一时间格式</label></div><label class="field"><span>整体时间偏移（毫秒；负数为提前）</span><input type="number" id="offset-ms" value="0"></label><details><summary>翻译歌词排版</summary><label class="field"><span>译文歌词（可粘贴 LRC；所选音频共用这份译文）</span><textarea id="translated-lyrics" rows="5" placeholder="留空时只整理当前歌词"></textarea></label><label class="field"><span>排版方式</span><select id="lyrics-layout"><option value="interleaved">原文与译文上下排列</option><option value="inline">原文与译文同一行</option><option value="original">只保留原文</option><option value="translation">只保留译文</option></select></label></details>`;
  if (toolTab === "chinese")
    body = `<p class="modal-description">按词组转换所选字段，先生成可核对的草稿。</p><div class="tool-form"><label class="field"><span>原文字体</span><select id="chinese-from"><option value="cn">简体中文</option><option value="tw">台湾正体</option><option value="hk">香港繁体</option><option value="t">通用繁体</option></select></label><label class="field"><span>转换为</span><select id="chinese-to"><option value="tw">台湾正体</option><option value="cn">简体中文</option><option value="hk">香港繁体</option><option value="twp">台湾正体与惯用词</option></select></label></div><div class="check-grid">${['title','artist','album','albumArtist','composer','lyricist','comment','lyrics'].map(k=>`<label><input type="checkbox" data-chinese-field="${k}" checked>${FIELDS[k]}</label>`).join('')}</div>`;
  if (toolTab === "clear")
    body = `<p class="modal-description">只清空勾选字段，先生成草稿，写入前仍可撤销。</p><div class="check-grid">${Object.entries(
      FIELDS,
    )
      .map(
        ([k, v]) =>
          `<label><input type="checkbox" data-clear-field="${k}">${v}</label>`,
      )
      .join(
        "",
      )}<label><input type="checkbox" id="clear-cover">封面</label></div>`;
  if (toolTab === "export")
    body = `<p class="modal-description">从原文件提取已写入的封面与歌词，保存到音频所在目录，同名文件默认跳过。</p><div class="check-grid"><label><input type="checkbox" id="export-cover" checked>提取封面</label><label><input type="checkbox" id="export-lyrics" checked>提取歌词</label></div>`;
  modal(
    `批量工具 · ${toolPaths.length} 首`,
    `<div class="tool-tabs">${tabs.map(([k, v]) => `<button class="button secondary ${toolTab === k ? "active" : ""}" data-tool-tab="${k}">${v}</button>`).join("")}</div>${body}<div id="tool-preview"></div>`,
    `<button class="button secondary" data-modal-action="close">关闭</button><button class="button primary" id="tool-run">${toolTab === "export" ? "开始提取" : toolTab === "rename" ? "预览文件名" : "生成修改草稿"}</button>`,
    "BATCH UTILITIES",
  );
  $("#tool-run").onclick = executeTool;
}
async function executeTool() {
  const button = $("#tool-run");
  button.disabled = true;
  try {
    const jobs = toolPaths.map((p) => ({
      path: p,
      tags: tags(p),
      filename: current(p).filename,
      stamp: current(p).stamp,
    }));
    if (toolTab === "rename") {
      const pattern = $("#tool-pattern").value;
      const r = await api("rename-preview", jobs, pattern);
      $("#tool-preview").innerHTML =
        `<div class="field-hint">确认以下新名称后执行。重名冲突会跳过，不覆盖现有文件。</div>${r.results.map((item) => `<div class="inline-status">${esc(basename(item.path))} → <strong>${esc(item.filename)}</strong></div>`).join("")}${r.errors.map((e) => `<div class="inline-status error-text">${esc(basename(e.path))}：${esc(e.message)}</div>`).join("")}`;
      button.textContent = `确认重命名 ${r.results.filter((i) => !i.unchanged).length} 首`;
      button.disabled = !r.results.some((i) => !i.unchanged);
      button.onclick = () => renameJobs(jobs, pattern);
      return;
    }
    if (toolTab === "export") {
      await run(async () => {
        const r = await api("export-sidecars", jobs, {
          cover: $("#export-cover").checked,
          lyrics: $("#export-lyrics").checked,
          overwrite: false,
        });
        if (r.errors.length)
          report(
            "提取结果",
            r.errors,
            `${r.results.reduce((n, i) => n + i.files.length, 0)} 个旁置文件已导出。`,
          );
        else
          toast(
            `已提取 ${r.results.reduce((n, i) => n + i.files.length, 0)} 个文件到音频目录`,
          );
      }, "正在提取封面与歌词…");
      return;
    }
    if (toolTab === "edit") {
      const changes = {};
      $$("[data-tool-field]:checked").forEach((el) => {
        changes[el.dataset.toolField] = $(
          `[data-tool-value="${el.dataset.toolField}"]`,
        ).value;
      });
      if (!Object.keys(changes).length) throw new Error("请先勾选要修改的字段");
      patch(toolPaths, changes);
      render();
      $("#modal").close();
      toast(`已为 ${toolPaths.length} 首生成修改草稿`);
      return;
    }
    let options = {};
    if (toolTab === "filename")
      options = {
        pattern: $("#tool-pattern").value,
        regex: $("#tool-regex").checked,
      };
    if (toolTab === "replace")
      options = {
        find: $("#tool-find").value,
        replace: $("#tool-replace").value,
        fields: $$("[data-replace-field]:checked").map(
          (el) => el.dataset.replaceField,
        ),
        regex: $("#tool-regex").checked,
        caseSensitive: $("#tool-case").checked,
      };
    if (toolTab === "lyrics")
      options = {
        stripTimes: $("#strip-times").checked,
        stripMetadata: $("#strip-metadata").checked,
        removeBlank: $("#remove-blank").checked,
        formatTimes: $("#format-times").checked,
        offsetMs: Number($("#offset-ms").value),
        ...($('#translated-lyrics').value.trim()?{translatedLyrics:$('#translated-lyrics').value,layout:$('#lyrics-layout').value}:{}),
      };
    if (toolTab === "chinese") {
      const fields = $$('[data-chinese-field]:checked').map(el=>el.dataset.chineseField);
      if (!fields.length) throw new Error('请先选择需要转换的字段');
      options = {from:$('#chinese-from').value,to:$('#chinese-to').value,fields};
    }
    if (toolTab === "clear")
      options = {
        fields: $$("[data-clear-field]:checked").map(
          (el) => el.dataset.clearField,
        ),
      };
    const clearImage = toolTab === "clear" && $("#clear-cover").checked;
    const r = await api("text-tools", toolTab, jobs, options);
    let changed = 0;
    for (const item of r) {
      if (item.error) continue;
      patch([item.path], item.tags, clearImage ? "" : undefined);
      changed++;
    }
    render();
    const errors = r.filter((item) => item.error);
    if (errors.length)
      report("草稿生成结果", errors, `${changed} 首已处理，尚未写入原文件。`);
    else {
      $("#modal").close();
      toast(`${changed} 首已生成草稿，请核对后写入`);
    }
  } catch (e) {
    toast(e.message, "error");
  } finally {
    if (button.isConnected && toolTab !== "rename") button.disabled = false;
  }
}
async function renameJobs(jobs, pattern) {
  await run(async () => {
    const r = await api("rename", jobs, pattern);
    for (const item of r.results) {
      const old = item.path,
        p = item.newPath;
      const i = files.findIndex((f) => f.path === old);
      if (i >= 0) replaceRecord(i, item.record);
      if (drafts[old]) {
        drafts[p] = drafts[old];
        if (p !== old) delete drafts[old];
      }
      if (selected.has(old)) {
        selected.delete(old);
        selected.add(p);
      }
      if (active === old) active = p;
      if (done.has(old)) {
        done.delete(old);
        done.add(p);
      }
    }
    await refreshAll(true);
    if (r.errors.length)
      report("重命名结果", r.errors, `${r.results.length} 首已处理。`);
    else {
      $("#modal").close();
      toast("重命名完成，可在历史中恢复");
    }
  }, "正在备份并重命名音频…");
}
function showSettings() {
  modal(
    "偏好设置",
    `<p class="modal-description">联网仅发送歌曲检索关键词。文件内容、音频和本地路径不上传。</p><label class="backup-setting"><input id="setting-backup" type="checkbox" ${settings.backupEnabled ? 'checked' : ''}><span><strong>自动备份原文件</strong><small>开启后，已有标签或封面的文件修改前会备份；空标签文件自动跳过。关闭后不再创建新备份，已有备份保留。</small></span></label>${providerOptions()}${policyOptionsHtml()}<div class="tool-form"><label class="field"><span>批量草稿相似度门槛（70–99%）</span><input type="number" id="setting-threshold" min="70" max="99" value="${settings.threshold}"></label><label class="field"><span>iTunes 首选地区</span><select id="setting-country">${[
      ["CN", "中国大陆"],
      ["JP", "日本"],
      ["US", "美国"],
    ]
      .map(
        ([k, v]) =>
          `<option value="${k}" ${settings.country === k ? "selected" : ""}>${v}</option>`,
      )
      .join(
        "",
      )}</select></label></div><p class="field-hint">iTunes 首选地区无结果时继续尝试日本及美国目录。在线服务可能限流或临时不可用，搜索结果会显示来源错误。</p>`,
    `<button class="button secondary" data-modal-action="close">取消</button><button class="button primary" id="save-settings">保存设置</button>`,
  );
  bindPolicyControls(null, false);
  $("#save-settings").onclick = async () => {
    const button = $('#save-settings'), options = completionOptions();
    button.disabled = true;
    let saved;
    try { saved = await api('preferences-set', { backupEnabled: $('#setting-backup').checked }); }
    catch (error) { toast(error.message, 'error'); button.disabled = false; return; }
    settings = {
      ...settings,
      backupEnabled: saved.backupEnabled,
      sources: options.sources,
      fields: options.fields,
      overwriteFields: $$('[data-policy-overwrite]:checked').map((el) => el.dataset.policyOverwrite),
      threshold: Math.max(
        70,
        Math.min(99, Number($("#setting-threshold").value) || 85),
      ),
      country: $("#setting-country").value,
    };
    persistSettings();
    updateBackupHint();
    $("#modal").close();
    toast("偏好设置已保存");
  };
}
function help() {
  modal(
    "开始整理你的音乐",
    `<ol class="help-list"><li>添加音频、导入文件夹，或直接把文件拖到窗口中。</li><li>单击封面，在右侧详情栏预览并编辑详细信息。</li><li>点击“补全信息”，搜索候选，勾选标签、封面与歌词后加入草稿。</li><li>使用 <kbd>Ctrl</kbd> 多选、<kbd>Shift</kbd> 连选，再执行批量补全或批量工具。</li><li>点击写入保存草稿。备份开启时，已有标签的文件修改前会自动备份；空标签文件跳过备份。</li><li>移除或清空队列不会删除音频；提示中的“撤回”可恢复队列。工作区与草稿会在本地暂存。</li></ol><p class="modal-description"><kbd>Ctrl + O</kbd> 添加音频 · <kbd>Ctrl + A</kbd> 全选当前视图 · <kbd>Ctrl + S</kbd> 写入所选草稿 · <kbd>Delete</kbd> 从队列移除所选</p><div class="inline-status">支持标签、主封面、内嵌歌词、重命名、文件名提取、查找替换、歌词整理、翻译排版、繁简转换与备份恢复。可调整封面分辨率并提取封面和歌词。部分原版旧站点来源、多封面分类管理与旁置文件同步改名尚未迁入。</div>`,
    `<button class="button primary" data-modal-action="close">开始使用</button>`,
  );
}
function updateNav() {
  $$("[data-filter]").forEach((el) =>
    el.classList.toggle("active", el.dataset.filter === filter),
  );
}
async function handleAction(action) {
  if (action === "import") return importFiles();
  if (action === "import-folder") return importFiles(true);
  if (action === "demo")
    return run(
      async () => addResult(await api("demo")),
      "正在载入本地合成演示音频…",
    );
  if (action === "remove") return removeQueue(false);
  if (action === "clear") return removeQueue(true);
  if (action === "refresh") return runBackground("refresh",files.length,id => refreshAll(false,id));
  if (action === "task-stop") return stopBackgroundTask();
  if (action === "task-view") return showBatchResults();
  if (action === "save-all") return writeFiles(Object.keys(drafts));
  if (action === "batch-match") return batchMatch();
  if (action === "extract-lyrics") return window.MusicLyrics.open('auto');
  if (action === "tools") return tools();
  if (action === "history") return showHistory();
  if (action === "settings") return showSettings();
  if (action === "help") return help();
  if (action === "theme") {
    window.MusicTheme.toggle({ origin: document.querySelector('[data-action="theme"]') });
  }
}
function coverManager() {
  const paths = previewTargets();
  let image = cover(active);
  modal(
    `封面管理 · ${paths.length} 首`,
    `<div class="cover-manager-preview" id="cover-manager-image">${artwork(image, "当前封面", false)}</div><div class="mini-actions"><button class="button secondary" id="cover-local">${icon("folder")}选择本地图片</button><button class="button secondary" id="cover-remove">${icon("trash")}清除主封面</button></div><label class="field"><span>网络图片地址（JPG / PNG / WebP）</span><input id="cover-url" placeholder="https://…"></label><button class="button secondary" id="cover-download">下载此图片</button><div class="tool-form"><label class="field"><span>最长边</span><select id="cover-size"><option value="0">保留原分辨率</option><option value="1600">1600 像素</option><option value="1200">1200 像素</option><option value="800">800 像素</option><option value="600">600 像素</option><option value="300">300 像素</option></select></label><label class="field"><span>嵌入格式</span><select id="cover-format"><option value="jpeg">JPEG</option><option value="png">PNG</option></select></label></div><p class="field-hint">修改所选音频的主封面；其他类型的内嵌图片保留。先生成草稿，写入前可撤销。</p>`,
    `<button class="button secondary" data-modal-action="close">取消</button><button class="button primary" id="cover-apply">加入草稿</button>`,
  );
  const show = () =>
    ($("#cover-manager-image").innerHTML = artwork(image, "封面预览", false));
  $("#cover-local").onclick = async () => {
    try {
      const value = await api("choose-cover");
      if (value) {
        image = value;
        show();
      }
    } catch (e) {
      toast(e.message, "error");
    }
  };
  $("#cover-remove").onclick = () => {
    image = "";
    show();
  };
  $("#cover-download").onclick = async () => {
    const button = $("#cover-download");
    button.disabled = true;
    try {
      image = await api("download-cover", $("#cover-url").value.trim());
      show();
    } catch (e) {
      toast(e.message, "error");
    } finally {
      button.disabled = false;
    }
  };
  $("#cover-apply").onclick = async () => {
    const button = $("#cover-apply");
    button.disabled = true;
    try {
      if (image)
        image = await api("transform-cover", image, {
          maxSize: Number($("#cover-size").value),
          format: $("#cover-format").value,
        });
      patch(paths, {}, image || "");
      renderPreview();
      $("#modal").close();
      toast("封面修改已加入草稿");
    } catch (e) {
      toast(e.message, "error");
      button.disabled = false;
    }
  };
}
async function handlePreview(action) {
  if (action === "close") {
    selected.clear();
    active = files[0]?.path || null;
    render();
    return;
  }
  if (action === "clear-all-tags") return clearAllTags();
  if (action === "save") return writeFiles(previewTargets());
  if (action === "match") return openMatch(active);
  if (action === "cover") return coverManager();
  if (action === "import-lyrics") {
    const text = await api("choose-lyrics");
    if (text !== null) {
      patch(previewTargets(), { lyrics: text });
      renderPreview();
    }
    return;
  }
  if (action === "extract-lyrics") return window.MusicLyrics.open(selected.size > 1 ? 'batch' : 'single');
  if (action === "lyrics-tools") return tools("lyrics");
  if (action === "discard") {
    for (const p of previewTargets()) delete drafts[p];
    persist();
    render();
    return;
  }
  if (action === "locate") return api("show-file", active);
  if (action === "play") {
    const player = $("#player");
    if (playing === active) {
      player.pause();
      playing = null;
    } else {
      player.src = window.music.mediaUrl(active);
      try {
        await player.play();
        playing = active;
      } catch {
        toast("此格式无法试听，标签编辑仍可继续。", "error");
      }
    }
    renderPreview();
  }
}
document.addEventListener("click", async (e) => {
  try {
    const action = e.target.closest("[data-action]");
    if (action) {
      await handleAction(action.dataset.action);
      return;
    }
    const windowButton = e.target.closest("[data-window]");
    if (windowButton) return api("window", windowButton.dataset.window);
    const nav = e.target.closest("[data-filter]");
    if (nav) {
      filter = nav.dataset.filter;
      pageSize = 100;
      updateNav();
      render();
      return;
    }
    const toggle = e.target.closest("[data-select]");
    if (toggle) {
      pick(toggle.dataset.select, { ctrlKey: true });
      return;
    }
    const tile = e.target.closest(".audio-tile");
    if (tile) {
      pick(tile.dataset.path, e);
      return;
    }
    const preview = e.target.closest("[data-preview-action]");
    if (preview) {
      await handlePreview(preview.dataset.previewAction);
      return;
    }
    const tab = e.target.closest("[data-tab]");
    if (tab) {
      previewTab = tab.dataset.tab;
      renderPreview();
      return;
    }
    const candidate = e.target.closest("[data-match-index]");
    if (candidate)
      return candidateReview(
        searchCandidates[Number(candidate.dataset.matchIndex)],
        searchTarget,
      );
    const compact = e.target.closest("[data-candidate]");
    if (compact)
      return candidateReview(
        matches[active][Number(compact.dataset.candidate)],
        active,
      );
    const tool = e.target.closest("[data-tool-tab]");
    if (tool) {
      toolTab = tool.dataset.toolTab;
      renderTools();
      return;
    }
    const restore = e.target.closest("[data-restore]");
    if (restore) return restoreBackup(restore.dataset.restore);
    const modalAction = e.target.closest("[data-modal-action]")?.dataset
      .modalAction;
    if (modalAction === "close") $("#modal").close();
    if (modalAction === 'background-task') {
      $('#modal').dataset.backgroundTask='true';$('#modal').close();renderBackgroundTask();
    }
    if (modalAction === "cancel-search") {
      await api("cancel-search");
      toast("已请求停止，已完成的候选会保留");
    }
    if (modalAction === "apply-review") await applyReview();
    if (modalAction === "open-data") await api("open-data");
  } catch (err) {
    toast(err.message, "error");
  }
});
document.addEventListener("input", (e) => {
  if (e.target.matches("[data-tag]")) {
    const key = e.target.dataset.tag;
    patch(previewTargets(), { [key]: e.target.value });
    e.target.classList.add("changed");
    const save = $('[data-preview-action="save"]');
    if (save) {
      save.textContent = `写入${selected.size > 1 ? selected.size + " 首" : "此音频"}的修改`;
      save.disabled = busy || !!backgroundTask || !previewTargets().some((p) => drafts[p]);
    }
  }
});
$("#library-search").addEventListener("input", (e) => {
  query = e.target.value.trim();
  pageSize = 100;
  renderCounts();
  renderGrid();
});
$("#sort").onchange = (e) => {
  sort = e.target.value;
  renderGrid();
};
$("#grid-size").oninput = (e) =>
  document.documentElement.style.setProperty(
    "--grid-size",
    e.target.value + "px",
  );
$("#select-all").onchange = (e) => {
  const list = visibleFiles();
  if (e.target.checked) {
    selected = new Set(list.map((f) => f.path));
    active = list[0]?.path || null;
  } else {
    selected.clear();
    active = null;
  }
  render();
};
$("#load-more").onclick = () => {
  pageSize += 100;
  renderGrid();
};
$("#modal-close").onclick = () => $("#modal").close();
$("#modal").addEventListener("close", () => {
  const dialog=$('#modal');
  if(dialog.open)return;
  if(dialog.dataset.backgroundTask==='true'){delete dialog.dataset.backgroundTask;return;}
  if($('#batch-results') && batchSession?.pending){batchSession.canceled=true;api('cancel-search').catch(()=>{});}
  else if(!backgroundTask)api('cancel-search').catch(()=>{});
});
$("#player").onended = () => {
  playing = null;
  renderPreview();
};
$("#player").onerror = () => {
  playing = null;
};
document.addEventListener("keydown", (e) => {
  if (e.target.matches("input,textarea,select") || $("#modal").open) return;
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key.toLowerCase() === "o") {
    e.preventDefault();
    importFiles();
  }
  if (ctrl && e.key.toLowerCase() === "a") {
    e.preventDefault();
    selected = new Set(visibleFiles().map((f) => f.path));
    active = [...selected][0];
    render();
  }
  if (ctrl && e.key.toLowerCase() === "s") {
    e.preventDefault();
    writeFiles([...selected]);
  }
  if (e.key === "Delete") {
    e.preventDefault();
    removeQueue(false);
  }
  if (e.key === "Escape") {
    selected.clear();
    active = null;
    render();
  }
  if ((e.key === "Enter" || e.key === " ") && e.target.closest(".audio-tile")) {
    e.preventDefault();
    pick(e.target.closest(".audio-tile").dataset.path, e);
  }
});
let dragDepth = 0;
document.addEventListener("dragenter", (e) => {
  if ([...e.dataTransfer.types].includes("Files")) {
    e.preventDefault();
    dragDepth++;
    $("#drop-overlay").hidden = false;
  }
});
document.addEventListener("dragover", (e) => {
  e.preventDefault();
});
document.addEventListener("dragleave", (e) => {
  e.preventDefault();
  dragDepth--;
  if (dragDepth <= 0) $("#drop-overlay").hidden = true;
});
document.addEventListener("drop", (e) => {
  e.preventDefault();
  dragDepth = 0;
  $("#drop-overlay").hidden = true;
  const paths = [...e.dataTransfer.files]
    .map((f) => window.music.filePath(f))
    .filter(Boolean);
  if (paths.length)
    run(
      async () => addResult(await api("import-paths", paths)),
      "正在导入拖入的音频…",
    );
});
const lyricRecord = p => p && current(p) ? { ...current(p), tags: tags(p) } : null;
window.MusicLyrics.configure({ api, modal, toast, status, icon, esc,
  getSelected: () => [...selected].map(lyricRecord).filter(Boolean),
  getActive: () => lyricRecord(active), getFiles: () => files.map(f => lyricRecord(f.path)),
  onBusy: value => { busy = value; updateButtons(); },
  subscribeProgress: callback => window.music.onLyricProgress(callback),
});
async function boot() {
  window.MusicTheme.apply(localStorage.getItem("theme") || "light", { animate: false });
  hydrate();
  render();
  try {
    const info = await api("get-info");
    $(".version").innerHTML = `${info.portable ? 'PORTABLE EDITION' : 'INSTALLED EDITION'} <span>v${esc(info.version)}</span>`;
    const preferences = await api("preferences-get");
    settings.backupEnabled = preferences.backupEnabled; updateBackupHint(); persistSettings();
    const saved = await api("session-load");
    if (saved?.paths?.length) {
      await run(async () => {
        const result = await api("import-paths", saved.paths);
        files = result.files;
        const valid = new Set(files.map((f) => f.path));
        drafts = Object.fromEntries(
          Object.entries(saved.drafts || {}).filter(([p]) => valid.has(p)),
        );
        done = new Set((saved.done || []).filter((p) => valid.has(p)));
        active = files[0]?.path || null; selected = active ? new Set([active]) : new Set();
        render();
        status(
          `已恢复工作区 · ${files.length} 首音频 · ${Object.keys(drafts).length} 份草稿`,
        );
        if (result.errors.length)
          toast(
            `${result.errors.length} 个文件无法恢复，可重新导入。`,
            "error",
          );
      }, "正在恢复本地工作区…");
    }
  } catch (e) {
    toast("工作区恢复失败：" + e.message, "error");
  }
}
boot();
