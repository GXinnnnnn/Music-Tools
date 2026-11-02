/* Standalone lyric workflow. The application owns IPC, the shared dialog and queue. */
(() => {
  "use strict";
  const SOURCES = { qq: "QQ 音乐", netease: "网易云音乐" };
  const FORMATS = { srt: "SRT 字幕", lrc: "LRC 歌词", txt: "TXT 文本" };
  const LAYOUTS = { bilingual: "原文 + 译文", original: "仅原文", translation: "仅译文" };
  const BILINGUAL_MODES = { lines: "同条双行", inline: "同条单行", cues: "原译独立条目", separate: "原文 / 译文分文件" };
  const NAME_PRESETS = { "{filename}": "原音频文件名", "{title} - {artist}": "歌名 - 艺术家", "{artist} - {title}": "艺术家 - 歌名" };
  const DEFAULTS = { sources: ["qq", "netease"], format: "srt", layout: "bilingual", bilingualMode: "lines", separator: " / ", filenameTemplate: "{title} - {artist}", offsetMs: 0, translationOffsetMs: 0, directory: "" };
  let config = {}, session = null, serial = 0;
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const e = (value) => (config.esc || escape)(value);
  const ico = (name) => config.icon ? config.icon(name) : "";
  const basename = (path) => String(path || "").split(/[\\/]/).pop();
  const message = (error) => typeof error === "string" ? error : error?.message || error?.error || "操作未完成，请重试。";
  const duration = (value) => Number(value) > 0 ? `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}` : "时长未知";
  const finiteOffset = (value) => Number.isFinite(Number(value)) ? Math.max(-3600000, Math.min(3600000, Number(value))) : 0;
  function loadSettings() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem("lyric-settings") || "{}"); } catch {}
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) saved = {};
    return {
      sources: Array.isArray(saved.sources) && saved.sources.some((key) => SOURCES[key]) ? Object.keys(SOURCES).filter((key) => saved.sources.includes(key)) : [...DEFAULTS.sources],
      format: Object.hasOwn(FORMATS, saved.format) ? saved.format : DEFAULTS.format,
      layout: Object.hasOwn(LAYOUTS, saved.layout) ? saved.layout : DEFAULTS.layout,
      bilingualMode: Object.hasOwn(BILINGUAL_MODES, saved.bilingualMode) ? saved.bilingualMode : DEFAULTS.bilingualMode,
      separator: typeof saved.separator === "string" ? saved.separator.slice(0, 40) : DEFAULTS.separator,
      filenameTemplate: typeof saved.filenameTemplate === "string" ? saved.filenameTemplate.slice(0, 300) : DEFAULTS.filenameTemplate,
      offsetMs: finiteOffset(saved.offsetMs), translationOffsetMs: finiteOffset(saved.translationOffsetMs),
      directory: typeof saved.directory === "string" ? saved.directory : "",
    };
  }
  function persist(s) {
    try { localStorage.setItem("lyric-settings", JSON.stringify(s.settings)); }
    catch { setError(s, "偏好设置暂时无法保存；本次操作仍可继续。"); }
  }
  function invoke(name, ...args) {
    try {
      const api = config.api || ((channel, ...values) => window.music.invoke(channel, ...values));
      return Promise.resolve(api(name, ...args));
    } catch (error) { return Promise.reject(error); }
  }
  function record(value) {
    if (typeof value === "string") value = (config.getFiles?.() || []).find((item) => item.path === value);
    if (!value?.path) return null;
    return { ...value, tags: { ...value.tags }, local: value.local ? { ...value.local, tags: { ...value.local.tags } } : undefined };
  }
  const local = (item) => item.local || item;
  const title = (item) => local(item).tags?.title || local(item).title || basename(item.path).replace(/\.[^.]+$/, "");
  const artist = (item) => local(item).tags?.artist || local(item).artist || "";
  const live = (s) => session === s && !s.closed && s.dialog.open && s.root.isConnected;
  function announce(text) { config.status?.(text); }
  function setError(s, text = "") {
    if (!live(s)) return;
    const el = s.root.querySelector("[data-lyric-error]");
    if (el) { el.textContent = text; el.hidden = !text; }
  }
  function setNotice(s, text = "") {
    if (!live(s)) return;
    const el = s.root.querySelector("[data-lyric-notice]");
    if (el) { el.textContent = text; el.hidden = !text; }
  }
  function busy(s, value, text) {
    s.busy = value;
    config.onBusy?.(Boolean(value));
    if (text) announce(text);
    syncControls(s);
  }
  function isSuccess(result) {
    return Boolean(result?.output) || ["success", "exported", "done", "ok"].includes(String(result?.status).toLowerCase());
  }
  function options(s) {
    const seconds = Number(local(s.song || {}).duration || s.song?.duration);
    return { format: s.settings.format, layout: s.settings.layout, bilingualMode: s.settings.bilingualMode, separator: s.settings.separator, filenameTemplate: s.settings.filenameTemplate, offsetMs: s.settings.offsetMs, translationOffsetMs: s.settings.translationOffsetMs, ...(seconds > 0 ? { duration: seconds } : {}), overwrite: false };
  }
  function invalidatePreview(s) {
    clearTimeout(s.previewTimer);
    s.requests.preview++;
    s.preview = null;
    s.previewPending = false;
    syncControls(s);
  }
  const canceledError = (error) => error?.name === "AbortError" || /abort|cancel|已取消|已停止/i.test(String(error?.code || "") + " " + message(error));
  function dismissResult(s, restoreFocus = true) {
    const result = s.result;
    if (!result) return;
    s.result = null;
    result.timers.forEach(clearTimeout);
    result.dialog.removeEventListener("close", result.onClose);
    if (result.dialog.open) result.dialog.close();
    result.dialog.remove();
    if (restoreFocus && live(s)) {
      const usable = (el) => el?.isConnected && !el.disabled && el.getClientRects().length;
      const focus = usable(result.focus) ? result.focus : [...s.dialog.querySelectorAll('#modal-footer button')].find(usable);
      focus?.focus({ preventScroll: true });
    }
  }
  function showResult(s, { kind, heading, summary, detail = "" }) {
    if (!live(s) || s.canceling) return;
    dismissResult(s, false);
    const dialog = document.createElement("dialog");
    dialog.id = "lyric-result-dialog";
    dialog.className = "lyric-result-dialog";
    dialog.dataset.resultKind = kind;
    dialog.setAttribute("aria-labelledby", "lyric-result-title");
    dialog.setAttribute("aria-describedby", "lyric-result-description");
    const shape = kind === "success" ? '<path d="m7 12 3 3 7-7"/>' : kind === "warning" ? '<path d="M12 7v6m0 4h.01"/>' : '<path d="m8 8 8 8m0-8-8 8"/>';
    dialog.innerHTML = `<div class="lyric-result-emblem" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/>${shape}</svg></div><h2 id="lyric-result-title" data-lyric-result-title>${e(heading)}</h2><div id="lyric-result-description"><p class="lyric-result-dialog-summary" data-lyric-result-summary>${e(summary)}</p>${detail ? `<p class="lyric-result-dialog-detail" data-lyric-result-detail>${e(detail)}</p>` : ""}</div><button type="button" class="button primary" data-lyric-result-confirm autofocus>确认（3）</button><p class="lyric-result-dismiss-hint">3 秒后自动关闭，可按 Esc 提前关闭</p>`;
    const result = { dialog, timers: [], focus: s.resultFocus || document.activeElement };
    s.resultFocus = null;
    result.onClose = () => dismissResult(s);
    dialog.addEventListener("close", result.onClose, { once: true });
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); event.stopPropagation(); dismissResult(s); });
    dialog.querySelector("[data-lyric-result-confirm]").addEventListener("click", () => dismissResult(s));
    s.result = result;
    // Keep the existing workspace and theme ancestry while using the native top layer.
    s.dialog.append(dialog);
    dialog.showModal();
    const button = dialog.querySelector("[data-lyric-result-confirm]");
    for (const [delay, remaining] of [[1000, 2], [2000, 1], [3000, 0]]) result.timers.push(setTimeout(() => {
      if (s.result !== result) return;
      if (!live(s)) { dismissResult(s, false); return; }
      if (!remaining) dismissResult(s);
      else button.textContent = `确认（${remaining}）`;
    }, delay));
  }
  function batchResult(s) {
    const b = s.batch;
    if (!b || b.canceled || s.canceling) return;
    const rows = b.runItems.map((item) => b.results.get(item.path));
    if (rows.some((row) => /cancel/i.test(row?.status || ""))) return;
    const exported = rows.filter(isSuccess).length;
    const review = rows.filter((row) => !isSuccess(row) && /ambiguous|review|uncertain/i.test(row?.status || "")).length;
    const failed = rows.length - exported - review;
    showResult(s, { kind: exported === rows.length ? "success" : exported ? "warning" : "failure",
      heading: exported === rows.length ? "批量提取完成" : exported ? "部分歌词已导出" : "本次未导出歌词",
      summary: `本次 ${rows.length} 首 · 已导出 ${exported} 首 · 需核对 ${review} 首 · 未完成 ${failed} 首`,
      detail: exported === rows.length ? "歌词已保存，详细路径保留在下方结果中。" : [rows.find((row) => !isSuccess(row))?.message, "可在下方重试未完成项，或逐首核对候选。"].filter(Boolean).join(" ") });
  }
  function cleanup(s) {
    if (s.closed) return;
    dismissResult(s, false);
    s.closed = true;
    clearTimeout(s.previewTimer);
    clearTimeout(s.filenameTimer);
    Object.keys(s.requests).forEach((key) => s.requests[key]++);
    s.observer?.disconnect();
    s.dialog.removeEventListener("close", s.onClose);
    s.dialog.removeEventListener("click", s.onClick);
    s.dialog.removeEventListener("input", s.onInput);
    s.dialog.removeEventListener("change", s.onChange);
    s.dialog.removeEventListener("keydown", s.onKeydown);
    if (typeof s.unsubscribe === "function") s.unsubscribe();
    s.dialog.classList.remove("lyric-dialog", "lyric-dialog-batch");
    if (s.busy) config.onBusy?.(false);
    if (session === s) session = null;
    // A close must also stop provider work that is still running in main.
    invoke("lyric-cancel").catch(() => {});
  }
  function settingsHTML(s) {
    const v = s.settings;
    return `<details class="lyric-settings"${s.settingsOpen ? " open" : ""}><summary>${ico("sliders")}导出与默认设置 <span data-lyric-setting-summary>${e(FORMATS[v.format])} · ${e(LAYOUTS[v.layout])}</span></summary>
      <div class="lyric-option-grid"><label class="lyric-field">导出格式<select class="form-input" data-lyric-setting="format">${Object.entries(FORMATS).map(([key, label]) => `<option value="${key}"${key === v.format ? " selected" : ""}>${label}</option>`).join("")}</select></label>
      <label class="lyric-field">歌词布局<select class="form-input" data-lyric-setting="layout">${Object.entries(LAYOUTS).map(([key, label]) => `<option value="${key}"${key === v.layout ? " selected" : ""}>${label}</option>`).join("")}</select></label>
      <label class="lyric-field">整体偏移（毫秒）<input class="form-input" data-lyric-setting="offsetMs" type="number" min="-3600000" max="3600000" step="1" value="${v.offsetMs}"></label>
      <label class="lyric-field">译文额外偏移（毫秒）<input class="form-input" data-lyric-setting="translationOffsetMs" type="number" min="-3600000" max="3600000" step="1" value="${v.translationOffsetMs}"></label></div>
      <div class="lyric-option-grid lyric-output-options"><label class="lyric-field">双语组织方式<select class="form-input" data-lyric-setting="bilingualMode">${Object.entries(BILINGUAL_MODES).map(([key, label]) => `<option value="${key}"${key === v.bilingualMode ? " selected" : ""}>${label}</option>`).join("")}</select></label>
      <label class="lyric-field" data-lyric-inline-field${v.bilingualMode === "inline" ? "" : " hidden"}>原文与译文分隔符<input class="form-input" data-lyric-setting="separator" maxlength="40" value="${e(v.separator)}"></label>
      <label class="lyric-field">文件名规则<select class="form-input" data-lyric-name-preset>${Object.entries(NAME_PRESETS).map(([key, label]) => `<option value="${e(key)}"${key === v.filenameTemplate ? " selected" : ""}>${label}</option>`).join("")}<option value="custom"${!Object.hasOwn(NAME_PRESETS, v.filenameTemplate) ? " selected" : ""}>自定义模板</option></select></label>
      <label class="lyric-field lyric-name-custom" data-lyric-custom-name${Object.hasOwn(NAME_PRESETS, v.filenameTemplate) ? " hidden" : ""}>自定义文件名模板<input class="form-input" data-lyric-setting="filenameTemplate" maxlength="300" value="${e(v.filenameTemplate)}"><small>可用 {filename}、{title}、{artist}、{album}、{track}、{source}</small></label></div>
      <p class="lyric-filename-example"><span>${s.mode === "batch" ? "首曲示例文件名" : "导出文件名"}：</span><strong data-lyric-filename>正在生成文件名预览…</strong></p>
      <p class="lyric-hint">正数延后，负数提前。译文额外偏移叠加在整体偏移上。修改后自动记为下次默认值。</p>
      <fieldset class="lyric-sources"><legend>歌词来源 <span>同等匹配优先 QQ 音乐</span></legend><div>${Object.entries(SOURCES).map(([key, label]) => `<label><input type="checkbox" data-lyric-source="${key}"${v.sources.includes(key) ? " checked" : ""}>${label}</label>`).join("")}</div></fieldset>
    </details>`;
  }
  function directoryHTML(s) {
    return `<div class="lyric-directory"><div class="lyric-directory-copy"><span>保存位置</span><strong data-lyric-directory title="${e(s.settings.directory || "每首音频所在的文件夹")}">${e(s.settings.directory || "音频所在文件夹")}</strong><small>同名文件自动加序号，保留已有文件。</small></div><div class="lyric-directory-actions"><button type="button" class="button secondary" data-lyric-action="directory">${ico("folder")}选择目录</button><button type="button" class="text-button" data-lyric-action="beside"${s.settings.directory ? "" : " hidden"}>恢复随音频保存</button></div></div>`;
  }
  function singleHTML(s) {
    return `<div class="lyric-song"><span class="lyric-song-icon">${ico("lyrics")}</span><div><strong>${e(title(s.song))}</strong><p>${e(artist(s.song) || "未知艺术家")} · ${duration(local(s.song).duration || s.song.duration)} · ${e(basename(s.song.path))}</p></div>${s.batch ? '<button class="text-button" data-lyric-action="back-batch">返回批量结果</button>' : s.items.length > 1 ? '<button class="text-button" data-lyric-action="batch-view">批量提取</button>' : ""}</div>
      <div class="lyric-alert" data-lyric-error role="alert" hidden></div><div class="lyric-notice" data-lyric-notice role="status" hidden></div>
      <form class="lyric-search" data-lyric-search-form><label class="lyric-field">歌曲标题<input class="form-input" data-lyric-query="title" value="${e(s.query.title)}" autocomplete="off"></label><label class="lyric-field">艺术家<input class="form-input" data-lyric-query="artist" value="${e(s.query.artist)}" autocomplete="off"></label><button type="button" class="button secondary" data-lyric-action="search">${ico("search")}搜索歌词</button></form>
      ${settingsHTML(s)}
      <div class="lyric-workspace"><section class="lyric-candidate-panel" aria-labelledby="lyric-candidates-title"><div class="lyric-section-heading"><h3 id="lyric-candidates-title">01 <span>选择匹配结果</span></h3><span data-lyric-candidate-count></span></div><div class="lyric-candidates" data-lyric-candidates><div class="lyric-empty">搜索 QQ 音乐与网易云音乐，选择录音版本后核对歌词。</div></div></section>
      <section class="lyric-edit-panel" aria-labelledby="lyric-edit-title"><div class="lyric-section-heading"><h3 id="lyric-edit-title">02 <span>核对与编辑</span></h3><span data-lyric-selected-source>尚未选择候选</span></div>
      <div class="lyric-tabs" role="tablist" aria-label="歌词内容"><button type="button" role="tab" id="lyric-tab-original" aria-controls="lyric-editor-original" aria-selected="true" tabindex="0" data-lyric-tab="original">原文</button><button type="button" role="tab" id="lyric-tab-translated" aria-controls="lyric-editor-translated" aria-selected="false" tabindex="-1" data-lyric-tab="translated">译文</button></div>
      <div role="tabpanel" id="lyric-editor-original" aria-labelledby="lyric-tab-original"><label class="lyric-sr-only" for="lyric-original">原文歌词，可编辑时间标签与内容</label><textarea id="lyric-original" class="form-input lyric-editor" data-lyric-text="original" spellcheck="false" placeholder="选择候选后，原文歌词会显示在这里。" disabled></textarea></div>
      <div role="tabpanel" id="lyric-editor-translated" aria-labelledby="lyric-tab-translated" hidden><label class="lyric-sr-only" for="lyric-translated">译文歌词，可编辑时间标签与内容</label><textarea id="lyric-translated" class="form-input lyric-editor" data-lyric-text="translated" spellcheck="false" placeholder="来源未提供译文时可留空，也可粘贴带时间标签的译文。" disabled></textarea></div>
      <p class="lyric-hint">可直接修改带时间标签的歌词。导出前请核对右侧生成的实际内容。</p></section>
      <section class="lyric-preview-panel" aria-labelledby="lyric-preview-title"><div class="lyric-section-heading"><h3 id="lyric-preview-title">03 <span>导出预览</span></h3><span class="lyric-format-badge" data-lyric-format>${e(s.settings.format.toUpperCase())}</span></div><pre class="lyric-preview" data-lyric-preview tabindex="0" aria-label="实际导出内容预览">选择候选并获取歌词后，将在此显示实际导出内容。</pre><p class="lyric-preview-meta" data-lyric-preview-meta role="status" aria-live="polite">等待歌词</p><ul class="lyric-warnings" data-lyric-warnings hidden></ul></section></div>
      ${directoryHTML(s)}<p class="lyric-privacy">${ico("shield")}仅发送歌曲搜索信息，音频文件与本地路径保留在电脑中。</p>`;
  }
  function batchHTML(s) {
    const b = s.batch;
    return `<div class="lyric-batch-intro"><span class="lyric-song-icon">${ico("lyrics")}</span><div><h3>为 ${s.items.length} 首音频提取歌词</h3><p>按当前设置自动匹配并导出。多个版本难以确定时跳过，完成后可逐首核对。</p></div></div>
      <div class="lyric-alert" data-lyric-error role="alert" hidden></div><div class="lyric-notice" data-lyric-notice role="status" hidden></div>
      <div class="lyric-default-summary" data-lyric-default-summary></div>${settingsHTML(s)}${directoryHTML(s)}
      <div class="lyric-batch-progress" data-lyric-batch-progress${b?.started ? "" : " hidden"}><div><strong data-lyric-progress-label>准备开始</strong><span data-lyric-progress-count>0 / ${s.items.length}</span></div><progress data-lyric-progress max="${s.items.length}" value="0" aria-label="批量歌词提取进度"></progress><p data-lyric-progress-detail></p></div>
      <div class="lyric-section-heading lyric-results-heading"><h3 data-lyric-results-title>${b?.started ? "提取结果" : "本次音频"}</h3><span data-lyric-result-summary>${s.items.length} 首</span></div><div class="lyric-results" data-lyric-results></div>
      <p class="lyric-privacy">${ico("shield")}文件留在本地。默认保留已有文件，不确定的匹配交由你核对。</p>`;
  }
  function footerHTML(s) {
    if (s.mode === "single") return `<span class="lyric-footer-status" data-lyric-footer-status role="status">先选择候选并核对预览</span><button type="button" class="button secondary" data-lyric-action="stop" hidden>停止</button><button type="button" class="button secondary" data-lyric-action="close">关闭</button><button type="button" class="button primary" data-lyric-action="export" disabled>${ico("save")}导出 ${s.settings.format.toUpperCase()}</button>`;
    return `<span class="lyric-footer-status" data-lyric-footer-status role="status">${s.batch?.started ? "已导出的文件会保留" : "准备就绪，按当前设置开始"}</span><button type="button" class="button secondary" data-lyric-action="close">关闭</button><button type="button" class="button secondary" data-lyric-action="stop" hidden>停止提取</button><button type="button" class="button secondary" data-lyric-action="retry" hidden>${ico("refresh")}重试未完成项</button><button type="button" class="button primary" data-lyric-action="start">${ico("lyrics")}开始提取 ${s.items.length} 首</button>`;
  }
  function render(s) {
    s.dialog.classList.toggle("lyric-dialog-batch", s.mode === "batch");
    invalidatePreview(s);
    s.root.innerHTML = s.mode === "single" ? singleHTML(s) : batchHTML(s);
    s.dialog.querySelector("#modal-title").textContent = s.mode === "single" ? "提取歌词 · 单首核对" : "批量提取歌词";
    s.dialog.querySelector("#modal-footer").innerHTML = footerHTML(s);
    const details = s.root.querySelector(".lyric-settings");
    details.addEventListener("toggle", () => { s.settingsOpen = details.open; });
    if (s.mode === "single") {
      renderCandidates(s);
      for (const key of ["original", "translated"]) s.root.querySelector(`[data-lyric-text="${key}"]`).value = s.lyrics[key];
      if (s.candidate) s.root.querySelector("[data-lyric-selected-source]").textContent = SOURCES[s.candidate.source] || s.candidate.source;
      schedulePreview(s, 0);
    } else { renderResults(s); updateProgress(s); scheduleFilename(s, 0); }
    syncControls(s);
  }
  function syncControls(s) {
    if (!live(s)) return;
    const pending = Boolean(s.busy);
    const invalidSettings = [...s.root.querySelectorAll('[data-lyric-setting][type="number"]')].some((el) => !el.validity.valid);
    s.root.querySelectorAll("input,select,textarea,button").forEach((el) => {
      const action = el.dataset.lyricAction;
      el.disabled = pending && !["close", "stop"].includes(action);
      if (el.dataset.lyricText && !s.loaded) el.disabled = true;
    });
    const f = s.dialog.querySelector("#modal-footer");
    f.querySelectorAll("button").forEach((el) => { el.disabled = pending && !["close", "stop"].includes(el.dataset.lyricAction); });
    const stop = f.querySelector('[data-lyric-action="stop"]');
    if (stop) { stop.hidden = !["search", "fetch", "batch"].includes(s.busy); stop.disabled = Boolean(s.canceling); stop.textContent = s.canceling ? "正在停止…" : s.busy === "batch" ? "停止提取" : "停止查询"; }
    const exportButton = f.querySelector('[data-lyric-action="export"]');
    if (exportButton) { exportButton.disabled = pending || invalidSettings || s.previewPending || s.filenamePending || !s.filenames?.length || !s.preview?.text?.trim(); exportButton.innerHTML = `${ico("save")}${s.busy === "export" ? "正在导出…" : "导出 " + s.settings.format.toUpperCase()}`; }
    const summary = s.root.querySelector("[data-lyric-setting-summary]");
    if (summary) summary.textContent = `${FORMATS[s.settings.format]} · ${LAYOUTS[s.settings.layout]}`;
    const format = s.root.querySelector("[data-lyric-format]");
    if (format) format.textContent = s.settings.format.toUpperCase();
    const inlineField = s.root.querySelector('[data-lyric-inline-field]');
    if (inlineField) inlineField.hidden = s.settings.bilingualMode !== "inline" || s.settings.layout !== "bilingual";
    const defaults = s.root.querySelector("[data-lyric-default-summary]");
    if (defaults) defaults.innerHTML = `<span>${ico("file")}${e(FORMATS[s.settings.format])}</span><span>${e(LAYOUTS[s.settings.layout])}${s.settings.layout === "bilingual" ? " · " + e(BILINGUAL_MODES[s.settings.bilingualMode]) : ""}</span><span>${e(s.settings.sources.map((key) => SOURCES[key]).join(" + ") || "请勾选歌词来源")}</span><span>保留同名文件</span>`;
    if (s.mode === "batch" && f.querySelector('[data-lyric-action="start"]')) {
      const started = Boolean(s.batch?.started), remaining = s.items.filter((item) => !isSuccess(s.batch?.results.get(item.path)));
      const start = f.querySelector('[data-lyric-action="start"]'), retry = f.querySelector('[data-lyric-action="retry"]');
      start.hidden = started; start.disabled = pending || invalidSettings || s.filenamePending || !s.filenames?.length || !s.settings.sources.length;
      retry.hidden = !started || pending || !remaining.length; retry.disabled = pending || invalidSettings || s.filenamePending || !s.filenames?.length || !s.settings.sources.length; retry.textContent = `重试 ${remaining.length} 首未完成项`;
      const label = f.querySelector('[data-lyric-footer-status]');
      if (label && started) label.textContent = pending ? s.canceling ? "正在停止提取…" : "正在提取，已完成的文件会保留" : `${s.items.length - remaining.length} 首已导出${remaining.length ? " · " + remaining.length + " 首可重试或单首核对" : " · 全部完成"}`;
    }
  }
  function renderCandidates(s) {
    if (!live(s) || s.mode !== "single") return;
    s.root.querySelector("[data-lyric-candidate-count]").textContent = s.candidates.length ? `${s.candidates.length} 个结果` : "";
    s.root.querySelector("[data-lyric-candidates]").innerHTML = s.candidates.length ? s.candidates.map((item, index) => {
      const selected = s.candidate === item;
      const seconds = Number(item.duration), ownDuration = Number(local(s.song).duration || s.song.duration);
      const difference = seconds > 0 && ownDuration > 0 ? ` · 相差 ${Math.abs(seconds - ownDuration).toFixed(1)} 秒` : "";
      const score = Number(item.score);
      return `<button type="button" class="lyric-candidate${selected ? " is-selected" : ""}" data-lyric-candidate="${index}" aria-pressed="${selected}"><span class="lyric-candidate-top"><span class="lyric-source">${e(SOURCES[item.source] || item.source)}</span>${Number.isFinite(score) ? `<span>匹配 ${Math.round(score > 1 ? score : score * 100)}%</span>` : ""}</span><strong>${e(item.title || "未提供标题")}</strong><span>${e(item.artist || "未知艺术家")}</span><span class="lyric-candidate-album">${e(item.album || "未提供专辑")}</span><span class="lyric-candidate-duration">${duration(seconds)}${e(difference)}${selected ? " · 已选择" : ""}</span></button>`;
    }).join("") : `<div class="lyric-empty">${e(s.searched ? "没有找到候选。试试修改标题、艺术家或歌词来源后重新搜索。" : "搜索后选择匹配的歌曲版本。")}</div>`;
    syncControls(s);
  }
  function clearLyrics(s) {
    s.loaded = false; s.candidate = null; s.lyrics = { original: "", translated: "" };
    invalidatePreview(s);
    if (s.mode !== "single") return;
    for (const key of ["original", "translated"]) s.root.querySelector(`[data-lyric-text="${key}"]`).value = "";
    s.root.querySelector("[data-lyric-selected-source]").textContent = "尚未选择候选";
    s.root.querySelector("[data-lyric-preview]").textContent = "选择候选并获取歌词后，将在此显示实际导出内容。";
    s.root.querySelector("[data-lyric-preview-meta]").textContent = "等待歌词";
    s.root.querySelector("[data-lyric-warnings]").hidden = true;
  }
  function providerErrors(errors) {
    return Array.isArray(errors) ? errors.map((error) => `${SOURCES[error.source] || error.source || "来源"}：${message(error)}`).join("；") : "";
  }
  async function search(s) {
    if (!live(s) || s.busy) return;
    s.query = { title: s.root.querySelector('[data-lyric-query="title"]').value.trim(), artist: s.root.querySelector('[data-lyric-query="artist"]').value.trim() };
    if (!s.query.title) { setError(s, "请填写歌曲标题后再搜索。"); s.root.querySelector('[data-lyric-query="title"]').focus(); return; }
    if (!s.settings.sources.length) { setError(s, "请在导出与默认设置中至少勾选一个歌词来源。"); s.root.querySelector(".lyric-settings").open = true; return; }
    setError(s); setNotice(s); clearLyrics(s); s.candidates = []; s.searched = true; s.requests.fetch++;
    const id = ++s.requests.search;
    busy(s, "search", `正在为「${title(s.song)}」搜索歌词…`);
    s.root.querySelector("[data-lyric-candidates]").innerHTML = '<div class="lyric-empty" role="status"><span class="busy-indicator"></span>正在搜索歌词来源…</div>';
    try {
      const result = await invoke("lyric-search", [s.query.title, s.query.artist].filter(Boolean).join(" "), { sources: [...s.settings.sources], local: local(s.song) });
      if (!live(s) || id !== s.requests.search) return;
      if (s.canceling) { setNotice(s, "搜索已停止。修改关键词后可重新搜索。"); return; }
      s.candidates = Array.isArray(result?.candidates) ? result.candidates : [];
      renderCandidates(s);
      const errors = providerErrors(result?.errors);
      if (errors) setNotice(s, errors);
      announce(`找到 ${s.candidates.length} 个歌词候选，请选择并核对版本。`);
    } catch (error) { if (live(s) && id === s.requests.search) { if (s.canceling) setNotice(s, "搜索已停止。修改关键词后可重新搜索。"); else setError(s, message(error)); } }
    finally { if (live(s) && id === s.requests.search) { s.canceling = false; busy(s, ""); renderCandidates(s); } }
  }
  async function fetchLyrics(s, index) {
    if (!live(s) || s.busy || !s.candidates[index]) return;
    clearLyrics(s); setError(s); setNotice(s);
    const id = ++s.requests.fetch, candidate = s.candidates[index];
    s.candidate = candidate; renderCandidates(s);
    busy(s, "fetch", `正在获取「${candidate.title}」歌词…`);
    s.root.querySelector("[data-lyric-selected-source]").textContent = "正在获取歌词…";
    try {
      const result = await invoke("lyric-fetch", candidate, {});
      if (!live(s) || id !== s.requests.fetch) return;
      if (s.canceling) { s.candidate = null; setNotice(s, "获取已停止，可以重新选择候选。"); return; }
      s.lyrics = { original: String(result?.original || ""), translated: String(result?.translated || "") };
      s.loaded = true;
      for (const key of ["original", "translated"]) s.root.querySelector(`[data-lyric-text="${key}"]`).value = s.lyrics[key];
      s.root.querySelector("[data-lyric-selected-source]").textContent = SOURCES[result?.source || candidate.source] || result?.source || candidate.source;
      const notes = [result?.instrumental ? "来源标记为纯音乐，没有可导出的演唱歌词。" : "", !s.lyrics.translated && !result?.instrumental ? "此来源未提供译文；可使用原文，或在译文页粘贴带时间标签的译文。" : "", providerErrors(result?.errors)].filter(Boolean);
      if (notes.length) setNotice(s, notes.join(" "));
      if (!s.lyrics.original.trim() && !s.lyrics.translated.trim()) setError(s, result?.instrumental ? "纯音乐暂无可导出歌词，请核对其他候选。" : "此候选没有可用歌词，请尝试其他候选。");
      schedulePreview(s, 0);
    } catch (error) { if (live(s) && id === s.requests.fetch) { s.candidate = null; if (s.canceling) setNotice(s, "获取已停止，可以重新选择候选。"); else setError(s, message(error)); } }
    finally { if (live(s) && id === s.requests.fetch) { s.canceling = false; busy(s, ""); renderCandidates(s); if (!s.loaded) s.root.querySelector("[data-lyric-selected-source]").textContent = "尚未获取歌词"; } }
  }
  function metadata(s, item = s.song) {
    const chosen = s.mode === "single" && item?.path === s.song?.path ? s.candidate || {} : {};
    const fields = { ...chosen, ...local(item || {}).tags };
    return { title: fields.title || title(item), artist: fields.artist || artist(item), album: fields.album || "", track: fields.track || "", source: chosen.source || "" };
  }
  function scheduleFilename(s, delay = 180) {
    clearTimeout(s.filenameTimer);
    const id = ++s.requests.filename;
    s.filenames = []; s.filenamePending = true;
    const el = s.root.querySelector('[data-lyric-filename]');
    if (el) el.textContent = "正在验证文件名…";
    syncControls(s);
    s.filenameTimer = setTimeout(async () => {
      try {
        const item = s.mode === "batch" ? s.items[0] : s.song;
        const result = await invoke("lyric-filename", { audioPath: item.path, metadata: metadata(s, item), options: options(s) });
        if (!live(s) || id !== s.requests.filename) return;
        s.filenames = Array.isArray(result?.filenames) ? result.filenames : [];
        if (el) el.textContent = s.filenames.length ? s.filenames.join(" · ") : "没有可用的文件名，请检查模板。";
      } catch (error) {
        if (!live(s) || id !== s.requests.filename) return;
        s.filenames = [];
        if (el) el.textContent = `文件名需调整：${message(error)}`;
      } finally { if (live(s) && id === s.requests.filename) { s.filenamePending = false; syncControls(s); } }
    }, delay);
  }
  function schedulePreview(s, delay = 320) {
    invalidatePreview(s);
    scheduleFilename(s, delay);
    if (!live(s) || s.mode !== "single" || !s.loaded) return;
    const id = s.requests.preview;
    s.previewPending = true;
    s.root.querySelector("[data-lyric-preview]").textContent = "正在生成预览…";
    s.root.querySelector("[data-lyric-preview-meta]").textContent = "正在验证歌词与时间轴…";
    s.root.querySelector("[data-lyric-warnings]").hidden = true;
    const footer = s.dialog.querySelector("[data-lyric-footer-status]");
    if (footer) footer.textContent = "预览更新后即可导出";
    syncControls(s);
    s.previewTimer = setTimeout(async () => {
      try {
        const result = await invoke("lyric-preview", { ...s.lyrics }, options(s));
        if (!live(s) || id !== s.requests.preview || s.mode !== "single") return;
        s.preview = result?.text?.trim() ? result : null;
        s.root.querySelector("[data-lyric-preview]").textContent = result?.text || "没有可导出的内容，请检查原文、译文与布局设置。";
        const cueCount = Array.isArray(result?.files) ? result.files.reduce((sum, file) => sum + (Array.isArray(file.cues) ? file.cues.length : 0), 0) : Array.isArray(result?.cues) ? result.cues.length : Number(result?.cues) || 0;
        s.root.querySelector("[data-lyric-preview-meta]").textContent = `${(result?.format || s.settings.format).toUpperCase()}${result?.files?.length ? " · " + result.files.length + " 个文件" : ""} · ${cueCount ? cueCount + " 条字幕" : result?.text ? "文本已生成" : "无可导出内容"}`;
        const warnings = Array.isArray(result?.warnings) ? result.warnings : [];
        const list = s.root.querySelector("[data-lyric-warnings]");
        list.innerHTML = warnings.map((warning) => `<li>${e(typeof warning === "string" ? warning : message(warning))}</li>`).join(""); list.hidden = !warnings.length;
        if (footer) footer.textContent = s.preview ? "请核对预览中的歌词与时间轴" : "检查歌词内容后重试";
      } catch (error) {
        if (!live(s) || id !== s.requests.preview) return;
        s.preview = null;
        s.root.querySelector("[data-lyric-preview]").textContent = "预览生成失败。修改歌词或导出设置后会重新验证。";
        s.root.querySelector("[data-lyric-preview-meta]").textContent = message(error);
        if (footer) footer.textContent = "预览未通过，暂时无法导出";
      } finally { if (live(s) && id === s.requests.preview) { s.previewPending = false; syncControls(s); } }
    }, delay);
  }
  async function exportLyrics(s) {
    if (!live(s) || s.busy || s.previewPending || s.filenamePending || !s.filenames?.length || !s.preview?.text?.trim() || [...s.root.querySelectorAll('[type="number"]')].some((el) => !el.validity.valid)) return;
    setError(s); setNotice(s);
    const id = ++s.requests.export;
    s.resultFocus = document.activeElement;
    busy(s, "export", `正在导出「${title(s.song)}」歌词…`);
    try {
      const result = await invoke("lyric-export", { audioPath: s.song.path, original: s.lyrics.original, translated: s.lyrics.translated, directory: s.settings.directory, metadata: metadata(s), candidate: s.candidate, options: options(s) });
      if (!live(s) || id !== s.requests.export) return;
      if (!result?.path) throw new Error("导出未返回保存路径，请重试。");
      const files = Array.isArray(result.files) && result.files.length ? result.files : [result];
      const text = `已导出${files.length > 1 ? " " + files.length + " 个文件" : ""}：${files.map((file) => file.path).join("；")}`;
      setNotice(s, text); config.toast?.(`歌词已保存${files.length > 1 ? " " + files.length + " 个文件" : "：" + (result.filename || basename(result.path))}`); announce(text);
      s.dialog.querySelector("[data-lyric-footer-status]").textContent = `已保存 ${result.filename || basename(result.path)}`;
      if (s.batch) s.batch.results.set(s.song.path, { path: s.song.path, output: result.path, outputs: files.map((file) => file.path), status: "exported", message: "已通过单首核对导出", candidate: s.candidate });
      showResult(s, { kind: "success", heading: "歌词导出成功", summary: `已为「${title(s.song)}」保存 ${files.length} 个 ${s.settings.format.toUpperCase()} 文件。`, detail: files.map((file) => file.filename || basename(file.path)).join(" · ") });
    } catch (error) {
      if (live(s) && id === s.requests.export) {
        setError(s, message(error));
        if (!canceledError(error)) showResult(s, { kind: "failure", heading: "歌词导出失败", summary: message(error), detail: "请检查保存目录或导出设置后重试，歌词编辑内容仍保留。" });
      }
    }
    finally { if (live(s) && id === s.requests.export) busy(s, ""); }
  }
  function resultLabel(result) {
    if (!result) return "等待提取";
    if (isSuccess(result)) return "已导出";
    const status = String(result.status || "").toLowerCase();
    if (/ambiguous|review|uncertain/.test(status)) return "需要核对";
    if (/instrumental/.test(status)) return "纯音乐";
    if (/cancel/.test(status)) return "已停止";
    if (/running|searching|fetching|pending|processing/.test(status)) return "处理中";
    if (/no.?match|not.?found|empty|no.?lyrics|skipped/.test(status)) return "未导出";
    return "未完成";
  }
  function renderResults(s) {
    if (!live(s) || s.mode !== "batch") return;
    const b = s.batch;
    const container = s.root.querySelector("[data-lyric-results]");
    s.root.querySelector('[data-lyric-results-title]').textContent = b?.started ? "提取结果" : "本次音频";
    container.innerHTML = s.items.map((item, index) => {
      const result = b?.results.get(item.path), success = isSuccess(result), label = resultLabel(result);
      const primary = typeof result?.output === "string" ? result.output : result?.output?.path || "";
      const outputs = Array.isArray(result?.outputs) && result.outputs.length ? result.outputs.map((file) => typeof file === "string" ? file : file.path).filter(Boolean) : primary ? [primary] : [];
      const output = outputs.join("；");
      return `<article class="lyric-result${success ? " is-success" : result ? " needs-review" : ""}"><span class="lyric-result-number">${String(index + 1).padStart(2, "0")}</span><div class="lyric-result-copy"><strong>${e(title(item))}</strong><span>${e(artist(item) || "未知艺术家")} · ${e(basename(item.path))}</span>${result ? `<p>${e(result.message || (success ? "歌词已保存" : "可重试，或进入单首核对选择正确版本。"))}</p>` : ""}${output ? `<small title="${e(output)}">${e(output)}</small>` : ""}</div><div class="lyric-result-actions"><span class="lyric-result-state">${e(label)}</span>${b?.started && !success && result ? `<button type="button" class="text-button" data-lyric-review="${index}">单首核对${ico("arrow-right")}</button>` : ""}</div></article>`;
    }).join("");
    if (b?.started) {
      const successful = s.items.filter((item) => isSuccess(b.results.get(item.path))).length;
      const finished = s.items.filter((item) => b.results.has(item.path)).length;
      s.root.querySelector("[data-lyric-result-summary]").textContent = `${successful} 首已导出 · ${Math.max(0, finished - successful)} 首待核对`;
    }
    syncControls(s);
  }
  function updateProgress(s) {
    if (!live(s) || s.mode !== "batch" || !s.batch?.started) return;
    const b = s.batch;
    const area = s.root.querySelector("[data-lyric-batch-progress]"); area.hidden = false;
    const total = b.runItems.length || s.items.length;
    const count = Math.min(total, Math.max(0, b.completed));
    s.root.querySelector("[data-lyric-progress]").max = total;
    s.root.querySelector("[data-lyric-progress]").value = count;
    s.root.querySelector("[data-lyric-progress-count]").textContent = `${count} / ${total}`;
    s.root.querySelector("[data-lyric-progress-label]").textContent = s.busy === "batch" ? s.canceling ? "正在停止，等待当前任务返回…" : "正在提取歌词…" : b.canceled ? "提取已停止" : "本次提取结束";
    s.root.querySelector("[data-lyric-progress-detail]").textContent = b.progressText || "";
  }
  function progress(s, event) {
    if (!live(s) || s.busy !== "batch" || !s.batch) return;
    const info = event?.detail || event || {}, b = s.batch;
    if (info.operationId !== b.operationId) return;
    if (Number.isFinite(Number(info.completed))) b.completed = Number(info.completed);
    else if (Number.isFinite(Number(info.done))) b.completed = Number(info.done);
    const path = info.path || info.current?.path || info.result?.path;
    b.progressText = info.message || (path ? `当前：${basename(path)}` : "正在查询并验证歌词…");
    const result = info.result?.path ? info.result : info.path && info.status ? info : null;
    if (result && b.runItems.some((item) => item.path === result.path)) { b.results.set(result.path, result); renderResults(s); }
    updateProgress(s);
  }
  async function startBatch(s, retry = false) {
    if (!live(s) || s.busy) return;
    if (s.filenamePending || !s.filenames?.length || [...s.root.querySelectorAll('[type="number"]')].some((el) => !el.validity.valid)) { setError(s, "请先检查导出设置与文件名预览。"); return; }
    if (!s.settings.sources.length) { setError(s, "请至少勾选一个歌词来源后再开始。"); s.root.querySelector(".lyric-settings").open = true; return; }
    if (!s.batch) s.batch = { results: new Map(), started: false, runItems: [], completed: 0 };
    const b = s.batch;
    b.runItems = retry ? s.items.filter((item) => !isSuccess(b.results.get(item.path))) : [...s.items];
    if (!b.runItems.length) return;
    b.started = true; b.canceled = false; b.completed = 0; b.progressText = "正在准备歌词来源…";
    s.root.querySelector('.lyric-settings').open = false;
    b.operationId = `lyrics-${s.id}-${Date.now()}-${s.requests.batch + 1}`;
    for (const item of b.runItems) b.results.delete(item.path);
    setError(s); setNotice(s);
    const id = ++s.requests.batch;
    s.resultFocus = document.activeElement;
    busy(s, "batch", `正在批量提取 ${b.runItems.length} 首歌词…`);
    renderResults(s); updateProgress(s);
    try {
      const result = await invoke("lyric-batch", b.runItems.map((item) => ({ path: item.path, local: local(item) })), { ...options(s), directory: s.settings.directory, sources: [...s.settings.sources], operationId: b.operationId });
      if (!live(s) || id !== s.requests.batch) return;
      for (const row of result?.results || []) if (row?.path) b.results.set(row.path, row);
      b.canceled = Boolean(result?.canceled || s.canceling);
      for (const item of b.runItems) if (!b.results.has(item.path)) b.results.set(item.path, { path: item.path, status: b.canceled ? "canceled" : "error", message: b.canceled ? "尚未处理，可重试或单首核对。" : "未返回结果，可重试或单首核对。" });
      b.completed = b.runItems.length;
      const errors = providerErrors(result?.errors);
      if (errors) setNotice(s, errors);
      const count = s.items.filter((item) => isSuccess(b.results.get(item.path))).length;
      b.progressText = `${count} 首已导出，${s.items.length - count} 首未导出。${s.items.length > count ? "可重试未完成项或单首核对。" : ""}`;
      announce(b.progressText); config.toast?.(b.progressText);
    } catch (error) {
      if (!live(s) || id !== s.requests.batch) return;
      b.canceled = Boolean(s.canceling || canceledError(error));
      setError(s, message(error));
      for (const item of b.runItems) if (!isSuccess(b.results.get(item.path))) b.results.set(item.path, { path: item.path, status: b.canceled ? "canceled" : "error", message: message(error) });
      b.progressText = "未完成项可重试，也可进入单首核对。";
    } finally { if (live(s) && id === s.requests.batch) { s.canceling = false; busy(s, ""); renderResults(s); updateProgress(s); batchResult(s); } }
  }
  async function chooseDirectory(s) {
    if (s.busy) return;
    setError(s); busy(s, "directory");
    try {
      const result = await invoke("lyric-directory");
      if (!live(s)) return;
      const path = typeof result === "string" ? result : result?.path;
      if (path) { s.settings.directory = path; persist(s); updateDirectory(s); }
    } catch (error) { if (live(s)) setError(s, message(error)); }
    finally { if (live(s)) busy(s, ""); }
  }
  function updateDirectory(s) {
    const label = s.root.querySelector("[data-lyric-directory]");
    label.textContent = s.settings.directory || "音频所在文件夹"; label.title = s.settings.directory || "每首音频所在的文件夹";
    s.root.querySelector('[data-lyric-action="beside"]').hidden = !s.settings.directory;
  }
  async function stop(s) {
    if (!s.busy || s.canceling) return;
    s.canceling = true; syncControls(s); updateProgress(s);
    try { await invoke("lyric-cancel"); }
    catch (error) { if (live(s)) { s.canceling = false; setError(s, `停止请求未完成：${message(error)}`); syncControls(s); } }
  }
  function reviewSong(s, item) {
    if (!item || s.busy) return;
    s.requests.search++; s.requests.fetch++;
    s.song = item; s.query = { title: title(item), artist: artist(item) }; s.candidates = []; s.searched = false;
    s.loaded = false; s.candidate = null; s.lyrics = { original: "", translated: "" }; s.mode = "single";
    render(s); search(s);
  }
  function switchTab(s, key, focus = false) {
    s.root.querySelectorAll("[data-lyric-tab]").forEach((tab) => {
      const selected = tab.dataset.lyricTab === key;
      tab.setAttribute("aria-selected", String(selected)); tab.tabIndex = selected ? 0 : -1;
      s.root.querySelector(`#lyric-editor-${tab.dataset.lyricTab}`).hidden = !selected;
      if (selected && focus) tab.focus();
    });
  }
  async function action(s, event) {
    const button = event.target.closest("[data-lyric-action], [data-lyric-candidate], [data-lyric-review], [data-lyric-tab]");
    if (!button || !s.dialog.contains(button) || button.disabled) return;
    const key = button.dataset.lyricAction;
    if (key === "close") { s.dialog.close(); return; }
    if (key === "stop") { await stop(s); return; }
    if (s.busy) return;
    if (button.dataset.lyricCandidate !== undefined) return fetchLyrics(s, Number(button.dataset.lyricCandidate));
    if (button.dataset.lyricReview !== undefined) return reviewSong(s, s.items[Number(button.dataset.lyricReview)]);
    if (button.dataset.lyricTab) return switchTab(s, button.dataset.lyricTab);
    if (key === "search") return search(s);
    if (key === "export") return exportLyrics(s);
    if (key === "directory") return chooseDirectory(s);
    if (key === "beside") { s.settings.directory = ""; persist(s); updateDirectory(s); }
    if (key === "start") return startBatch(s);
    if (key === "retry") return startBatch(s, true);
    if (["back-batch", "batch-view"].includes(key)) { s.requests.search++; s.requests.fetch++; s.mode = "batch"; render(s); }
  }
  function input(s, event) {
    if (s.busy) return;
    const el = event.target;
    if (el.dataset.lyricQuery) s.query[el.dataset.lyricQuery] = el.value;
    if (el.dataset.lyricText) { s.lyrics[el.dataset.lyricText] = el.value; setError(s); schedulePreview(s); }
    const key = el.dataset.lyricSetting;
    if (key && ["separator", "filenameTemplate"].includes(key)) { s.settings[key] = el.value; persist(s); setError(s); schedulePreview(s); syncControls(s); }
    if (key && ["offsetMs", "translationOffsetMs"].includes(key)) {
      if (!el.validity.valid) { invalidatePreview(s); el.setAttribute("aria-invalid", "true"); setError(s, "偏移值应在 -3600000 至 3600000 毫秒之间。"); s.root.querySelector("[data-lyric-preview-meta]")?.replaceChildren(document.createTextNode("请调整偏移值后再导出。")); syncControls(s); return; }
      el.removeAttribute("aria-invalid"); setError(s);
      s.settings[key] = finiteOffset(el.value); persist(s); schedulePreview(s); syncControls(s);
    }
  }
  function change(s, event) {
    if (s.busy) return;
    const el = event.target, key = el.dataset.lyricSetting;
    if (key && ["format", "layout", "bilingualMode"].includes(key)) { s.settings[key] = el.value; persist(s); setError(s); schedulePreview(s); syncControls(s); }
    if (el.matches('[data-lyric-name-preset]')) {
      const custom = el.value === "custom";
      s.root.querySelector('[data-lyric-custom-name]').hidden = !custom;
      if (!custom) { s.settings.filenameTemplate = el.value; s.root.querySelector('[data-lyric-setting="filenameTemplate"]').value = el.value; persist(s); schedulePreview(s); }
      else s.root.querySelector('[data-lyric-setting="filenameTemplate"]').focus();
    }
    if (el.dataset.lyricSource) { s.settings.sources = Object.keys(SOURCES).filter((source) => s.root.querySelector(`[data-lyric-source="${source}"]`)?.checked); persist(s); setError(s); syncControls(s); }
  }
  function configure(next = {}) { config = { ...config, ...next }; return window.MusicLyrics; }
  function open(mode = "auto") {
    if (session && live(session)) { session.dialog.focus(); return; }
    if (session) cleanup(session);
    if (typeof config.modal !== "function") throw new Error("MusicLyrics.configure() requires the application's modal helper.");
    const items = [...new Map((config.getSelected?.() || []).map(record).filter(Boolean).map((item) => [item.path, item])).values()];
    const active = record(config.getActive?.()) || items[0];
    if (!active && !items.length) { config.toast?.("请先导入并选择本地音频，再提取歌词。"); return; }
    if (!items.length && active) items.push(active);
    const chosenMode = mode === "single" ? "single" : mode === "batch" || items.length >= 2 ? "batch" : "single";
    config.modal(chosenMode === "single" ? "提取歌词 · 单首核对" : "批量提取歌词", '<div id="lyric-ui" class="lyric-ui"></div>', "", "MUSIC TOOLS / LYRICS");
    const dialog = document.querySelector("#modal"), root = dialog.querySelector("#lyric-ui");
    const s = { id: ++serial, dialog, root, items, song: active || items[0], mode: chosenMode, settings: loadSettings(), settingsOpen: false,
      busy: "", closed: false, canceling: false, candidates: [], candidate: null, searched: false, loaded: false, filenames: [], filenamePending: false,
      lyrics: { original: "", translated: "" }, preview: null, previewPending: false, requests: { search: 0, fetch: 0, preview: 0, filename: 0, export: 0, batch: 0 }, batch: null };
    s.settingsOpen = chosenMode === "batch";
    s.query = { title: title(s.song), artist: artist(s.song) };
    session = s; dialog.classList.add("lyric-dialog"); dialog.setAttribute("aria-labelledby", "modal-title");
    // A queued close from the previous shared-modal owner can arrive after reopening.
    s.onClose = () => { if (!s.dialog.open) cleanup(s); };
    s.onClick = (event) => { action(s, event).catch((error) => { if (live(s)) { setError(s, message(error)); busy(s, ""); } }); };
    s.onInput = (event) => input(s, event); s.onChange = (event) => change(s, event);
    s.onKeydown = (event) => {
      if (event.target.matches("[data-lyric-query]") && event.key === "Enter") { event.preventDefault(); search(s); }
      if (event.target.matches("[data-lyric-tab]") && ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) { event.preventDefault(); switchTab(s, event.key === "Home" ? "original" : event.key === "End" ? "translated" : event.target.dataset.lyricTab === "original" ? "translated" : "original", true); }
    };
    dialog.addEventListener("close", s.onClose); dialog.addEventListener("click", s.onClick);
    dialog.addEventListener("input", s.onInput); dialog.addEventListener("change", s.onChange); dialog.addEventListener("keydown", s.onKeydown);
    // Other app tools can replace the one shared modal without firing close.
    s.observer = new MutationObserver(() => { if (!root.isConnected || dialog.querySelector("#lyric-ui") !== root) cleanup(s); });
    s.observer.observe(dialog.querySelector("#modal-body"), { childList: true });
    try {
      const subscribe = config.subscribeProgress || (window.music?.onLyricProgress ? (callback) => window.music.onLyricProgress(callback) : null);
      s.unsubscribe = subscribe?.((event) => progress(s, event));
    } catch {}
    render(s);
    if (chosenMode === "single") search(s);
    else dialog.querySelector('[data-lyric-action="start"]')?.focus();
  }
  window.MusicLyrics = { configure, open };
})();
