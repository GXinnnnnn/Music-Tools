'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { createRequire } = require('node:module');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const manifest = require('../package.json');
const portable = path.join(root, 'release', 'Music Tools');
const { generatedPath } = require('./package.cjs');

function quote(value) {
  if (/[\r\n]/.test(value)) throw new Error('NSIS values must be single-line');
  return '"' + value.replace(/\$/g, '$$').replace(/"/g, '$\\"') + '"';
}
async function compilerPath() {
  if (process.env.MUSIC_TOOLS_MAKENSIS) {
    const explicit = path.resolve(process.env.MUSIC_TOOLS_MAKENSIS);
    if (!fs.existsSync(explicit)) throw new Error('MUSIC_TOOLS_MAKENSIS does not exist: ' + explicit);
    return explicit;
  }
  const cache = path.join(process.env.ELECTRON_BUILDER_CACHE || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'electron-builder', 'Cache'), 'nsis', 'nsis-3.0.4.1-nsis-3.0.4.1', 'makensis.exe');
  if (fs.existsSync(cache)) return cache;
  // Reuse the installed development dependency's checksum-verified NSIS download.
  const candidate = process.env.MUSIC_TOOLS_BUILDER_MODULE || 'electron-builder';
  let builder;
  try { builder = require.resolve(candidate, { paths: [root] }); }
  catch { throw new Error('NSIS is not cached. Run npm ci, set MUSIC_TOOLS_MAKENSIS to makensis.exe, or set MUSIC_TOOLS_BUILDER_MODULE to an installed electron-builder module.'); }
  const builderRequire = createRequire(builder);
  const library = path.dirname(builderRequire.resolve('app-builder-lib/package.json'));
  const nsis = require(path.join(library, 'out', 'targets', 'nsis', 'nsisUtil.js'));
  nsis.NsisTargetOptions.resolve({});
  return path.join(await nsis.NSIS_PATH(), 'makensis.exe');
}
function run(executable, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error('NSIS exited with code ' + code)));
  });
}
async function buildInstaller() {
  if (process.platform !== 'win32') throw new Error('This installer build requires Windows and the Windows x64 portable runtime.');
  const inventory = JSON.parse(fs.readFileSync(path.join(portable, '.music-tools-generated.json'), 'utf8'));
  const app = JSON.parse(fs.readFileSync(path.join(portable, 'resources', 'app', 'package.json'), 'utf8'));
  if (inventory.format !== 1 || !Array.isArray(inventory.files) || app.version !== manifest.version || inventory.version !== manifest.version) throw new Error('Portable build is missing or out of date. Run node scripts/package.cjs first.');
  if (fs.existsSync(path.join(portable, 'resources', 'installed-mode'))) throw new Error('Portable resources must not contain installed-mode.');
  const exe = fs.readFileSync(path.join(portable, 'Music Tools.exe'));
  if (exe.readUInt16LE(exe.readUInt32LE(0x3c) + 4) !== 0x8664) throw new Error('Installer payload must be Windows x64.');
  // Install the same payload inventory used by the optional, data-safe compression helper.
  const files = [...new Set([...inventory.files, '.music-tools-generated.json'])].sort();
  const directories = new Set();
  const install = ['!macro MT_InstallPayload'];
  const uninstall = ['!macro MT_UninstallPayload'];
  let size = 0;
  let previousDirectory;
  for (const relative of files) {
    const source = generatedPath(relative);
    if (!fs.statSync(source).isFile()) throw new Error('Missing payload file: ' + source);
    if (relative === 'resources/installed-mode' || relative.split('/')[0].toLowerCase() === 'data') throw new Error('Installer cannot package user data or installed-mode');
    size += fs.statSync(source).size;
    const directory = path.posix.dirname(relative);
    if (directory !== previousDirectory) { install.push('  SetOutPath ' + quote('$INSTDIR' + (directory === '.' ? '' : '\\' + directory.replaceAll('/', '\\'))).replace('$$INSTDIR', '$INSTDIR')); previousDirectory = directory; }
    install.push('  ClearErrors', '  File ' + quote('/oname=' + path.posix.basename(relative)) + ' ' + quote(source), '  IfErrors installFailed');
    uninstall.push('  ClearErrors', '  Delete ' + quote('$INSTDIR\\' + relative.replaceAll('/', '\\')).replace('$$INSTDIR', '$INSTDIR'), '  IfErrors uninstallFailed');
    for (let dir = directory; dir !== '.'; dir = path.posix.dirname(dir)) directories.add(dir);
  }
  install.push('!macroend'); uninstall.push('!macroend');
  const removeDirectories = ['!macro MT_RemoveEmptyDirectories', ...[...directories].sort((a, b) => b.split('/').length - a.split('/').length).map(dir => '  RMDir ' + quote('$INSTDIR\\' + dir.replaceAll('/', '\\')).replace('$$INSTDIR', '$INSTDIR')), '!macroend'];
  const output = path.join(root, 'release', `Music Tools Setup ${manifest.version} x64.exe`);
  const work = path.join(root, 'artifacts', 'installer');
  fs.mkdirSync(work, { recursive: true });
  const version = manifest.version.split('-')[0].split('.');
  if (version.length !== 3 || version.some(v => !/^\d+$/.test(v) || Number(v) > 65535)) throw new Error('NSIS requires a three-part numeric application version');
  const script = [
    '!define MT_VERSION ' + quote(manifest.version),
    '!define MT_WINDOWS_VERSION ' + quote([...version, '0'].join('.')),
    '!define MT_OUTPUT ' + quote(output),
    '!define MT_ICON ' + quote(path.join(root, 'source', 'ui', 'assets', 'icon.ico')),
    '!define MT_SIZE_KIB ' + Math.ceil(size / 1024),
    ...install, ...uninstall, ...removeDirectories,
    '!include ' + quote(path.join(__dirname, 'installer.nsh')),
  ].join('\r\n') + '\r\n';
  const scriptPath = path.join(work, 'music-tools.nsi');
  fs.writeFileSync(scriptPath, '\ufeff' + script);
  const compiler = await compilerPath();
  console.log('Building Windows x64 per-user NSIS installer with ' + compiler);
  await run(compiler, ['/V3', scriptPath], root);
  const result = { version: manifest.version, output, installerBytes: fs.statSync(output).size, payloadBytes: size, payloadFiles: files.length, architecture: 'win32-x64', compiler, installedMarker: 'resources/installed-mode', perUser: true, uninstallStrategy: 'enumerated shipped files; empty directories only; no user-data removal', executableSHA256: crypto.createHash('sha256').update(fs.readFileSync(output)).digest('hex'), builtAt: new Date().toISOString() };
  fs.writeFileSync(path.join(root, 'artifacts', 'installer-build.json'), JSON.stringify(result, null, 2));
  console.log('Windows installer: ' + output + ' (' + result.installerBytes + ' bytes)');
  return result;
}
module.exports = { buildInstaller, compilerPath, quote };
if (require.main === module) buildInstaller().catch(error => { console.error(error); process.exitCode = 1; });
