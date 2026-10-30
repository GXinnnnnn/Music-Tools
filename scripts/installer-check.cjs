'use strict';
// A real, isolated NSIS install / Electron launch / uninstall smoke test. No library music is opened.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { _electron: electron } = require('@playwright/test');
const root = path.resolve(__dirname, '..');
const manifest = require('../package.json');
const installer = path.resolve(process.argv[2] || path.join(root, 'release', `Music Tools Setup ${manifest.version} x64.exe`));
const base = path.join(root, 'artifacts', 'installer-smoke', new Date().toISOString().replace(/[:.]/g, '-'));
const destination = path.join(base, 'installed');
const blocked = path.join(base, 'protected-portable');
const appData = path.join(base, 'user-data');
const uninstallKey = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Music Tools';
const ownKey = 'HKCU\\Software\\Music Tools';
function run(exe, args, expected = 0) {
  // NSIS requires its final /D= or _?= argument unquoted, including spaces.
  const child = spawnSync(exe, args, { encoding: 'utf8', windowsHide: true, windowsVerbatimArguments: true, timeout: 180000 });
  if (child.error) throw child.error;
  assert.equal(child.status, expected, `${exe}: ${child.stdout || ''} ${child.stderr || ''}`);
  return (child.stdout || '').trim();
}
function registryExists(key) { return spawnSync('reg.exe', ['query', key], { encoding: 'utf8', windowsHide: true }).status === 0; }
function waitFor(predicate, timeout = 30000) {
  const deadline = Date.now() + timeout;
  return new Promise((resolve, reject) => {
    const check = () => { if (predicate()) resolve(); else if (Date.now() > deadline) reject(new Error('Timed out waiting for uninstaller')); else setTimeout(check, 100); };
    check();
  });
}
(async () => {
  if (registryExists(uninstallKey) || registryExists(ownKey)) throw new Error('An existing registered Music Tools install was found. Smoke test refuses to change it. Use a disposable Windows account.');
  const shortcuts = [path.join(process.env.USERPROFILE, 'Desktop', 'Music Tools.lnk'), path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs', 'Music Tools', 'Music Tools.lnk')];
  for (const shortcut of shortcuts) if (fs.existsSync(shortcut)) throw new Error('Existing shortcut protected: ' + shortcut);
  fs.mkdirSync(blocked, { recursive: true });
  fs.writeFileSync(path.join(blocked, 'user-recording.wav'), 'protected user audio sentinel');
  run(installer, ['/S', '/D=' + blocked], 2);
  assert.equal(fs.readFileSync(path.join(blocked, 'user-recording.wav'), 'utf8'), 'protected user audio sentinel');
  assert.equal(fs.existsSync(path.join(blocked, 'Music Tools.exe')), false);
  run(installer, ['/S', '/D=' + destination]);
  const installedExe = path.join(destination, 'Music Tools.exe');
  assert.ok(fs.existsSync(installedExe));
  assert.match(fs.readFileSync(path.join(destination, 'resources', 'installed-mode'), 'utf8'), /Music Tools installed/);
  assert.equal(fs.existsSync(path.join(destination, 'data')), false);
  assert.deepEqual(fs.readdirSync(path.join(destination, 'locales')).sort(), ['en-US.pak', 'zh-CN.pak']);
  for (const shortcut of shortcuts) assert.ok(fs.existsSync(shortcut), 'Missing shortcut: ' + shortcut);
  assert.ok(registryExists(uninstallKey));
  const env = { ...process.env, MUSIC_TOOLS_DATA_DIR: appData, PATH: 'C:\\Windows\\System32;C:\\Windows', PYTHONDONTWRITEBYTECODE: '1' };
  for (const name of ['ELECTRON_RUN_AS_NODE', 'MUSIC_TOOLS_PYTHON', 'MUSIC_TOOLS_TEST_PYTHON', 'MUSIC_TOOLS_ELECTRON']) delete env[name];
  let runtime;
  const application = await electron.launch({ executablePath: installedExe, env, timeout: 60000 });
  try {
    const page = await application.firstWindow();
    const rendererErrors = [];
    page.on('pageerror', error => rendererErrors.push(error.message));
    const invoke = (name, ...args) => page.evaluate(({ name, args }) => window.music.invoke(name, ...args), { name, args });
    runtime = await application.evaluate(({ app }) => ({ packaged: app.isPackaged, execPath: process.execPath, appPath: app.getAppPath(), userData: app.getPath('userData') }));
    assert.equal(runtime.packaged, true);
    assert.equal(runtime.execPath, installedExe);
    const info = await invoke('get-info');
    assert.equal(info.dataDir, appData);
    const records = (await invoke('demo')).files;
    assert.ok(records.length >= 8);
    assert.ok(records.every(file => file.duration > 0 && file.stamp.sha256));
    const chinese = await invoke('text-tools', 'chinese', [{ path: records[0].path, tags: { title: '音乐与头发' } }], { from: 'cn', to: 'tw', fields: ['title'] });
    assert.equal(chinese[0].tags.title, '音樂與頭髮');
    assert.deepEqual(rendererErrors, []);
    await page.screenshot({ path: path.join(base, 'installed-launch.png') });
  } finally { await application.close(); }
  // Added files exercise the guarantee even inside a generated subtree. No recursive removal is used.
  const sentinels = [path.join(destination, 'user-audio.wav'), path.join(destination, 'data', 'portable-state.json'), path.join(destination, 'resources', 'user-added.flac'), path.join(appData, 'user-history.json')];
  for (const file of sentinels) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, 'preserve-me'); }
  // _?= prevents NSIS from spawning a detached temporary uninstaller and makes completion observable.
  run(path.join(destination, 'Uninstall.exe'), ['/S', '_?=' + destination]);
  await waitFor(() => !fs.existsSync(installedExe));
  for (const file of sentinels) assert.equal(fs.readFileSync(file, 'utf8'), 'preserve-me', 'Uninstall removed user data: ' + file);
  assert.equal(fs.existsSync(path.join(destination, 'resources', 'installed-mode')), false);
  assert.equal(registryExists(uninstallKey), false);
  for (const shortcut of shortcuts) assert.equal(fs.existsSync(shortcut), false);
  const result = { passed: true, version: manifest.version, installer, installerSHA256: crypto.createHash('sha256').update(fs.readFileSync(installer)).digest('hex'), base, destination, runtime, checks: ['silent per-user custom-directory install', 'populated unmarked directory rejected', 'installed marker created by NSIS', 'no portable data packaged', 'English and Simplified Chinese locales only', 'shortcuts and HKCU uninstall registration', 'Playwright packaged launch with restricted PATH', 'bundled Python demo audio metadata', 'offline Chinese conversion', 'silent enumerated-file uninstall', 'added root audio, resource audio, portable data and per-user data preserved'] };
  fs.writeFileSync(path.join(root, 'artifacts', 'installer-check.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
})().catch(error => { console.error(error); process.exitCode = 1; });
