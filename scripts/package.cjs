'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '..');
const manifest = require('../package.json');
const out = path.join(root, 'release', 'Music Tools');
const inventoryName = '.music-tools-generated.json';
const locales = new Set(['en-US.pak', 'zh-CN.pak']);
const publicDocs = new Set(['docs/distribution.md', 'docs/providers.md', 'docs/text-tools.md', 'docs/lyrics.md']);
function isPublicDoc(relative) {
  return publicDocs.has(relative) || /^docs\/images\/[a-zA-Z0-9._-]+\.(png|webp|jpg)$/i.test(relative);
}

function relativeFile(base, filename) {
  const relative = path.relative(base, filename);
  if (!relative || path.isAbsolute(relative) || relative.split(path.sep).includes('..')) throw new Error('Unsafe generated path: ' + filename);
  return relative.split(path.sep).join('/');
}
function generatedPath(relative) {
  if (typeof relative !== 'string' || relative.includes('\\') || relative.includes(':') || relative.split('/').some(p => !p || p === '.' || p === '..') || relative.split('/')[0].toLowerCase() === 'data') throw new Error('Unsafe generated inventory entry: ' + relative);
  const target = path.resolve(out, relative);
  relativeFile(out, target);
  // Never follow a user-created junction or symbolic link during packaging.
  for (let dir = target; dir !== out; dir = path.dirname(dir)) if (fs.existsSync(dir) && fs.lstatSync(dir).isSymbolicLink()) throw new Error('Generated path traverses a link: ' + dir);
  return target;
}
function walk(directory) {
  if (!fs.existsSync(directory)) return [];
  const files = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const filename = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Unexpected symbolic link: ' + filename);
    if (entry.isDirectory()) files.push(...walk(filename)); else if (entry.isFile()) files.push(filename);
  }
  return files;
}
function bytes(directory, excludeData = false) {
  let total = 0;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (excludeData && entry.name.toLowerCase() === 'data') continue;
    const filename = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw new Error('Unexpected symbolic link: ' + filename);
    total += entry.isDirectory() ? bytes(filename) : fs.statSync(filename).size;
  }
  return total;
}
function includeSource(filename) {
  const parts = relativeFile(path.join(root, 'source'), filename).split('/');
  const name = parts.at(-1);
  if (parts.includes('__pycache__') || /\.py[co]$/i.test(name) || name === '.DS_Store') return false;
  if (parts[0] === 'vendor' && parts.some(part => /^(tests?|docs?|\.pytest_cache)$/i.test(part))) return false;
  if (parts[0] === 'vendor' && parts[1] === 'python-libs' && ['bin', 'share'].includes(parts[2])) return false;
  return true;
}
async function buildPortable() {
  await require('./bootstrap-python.cjs').ensurePython();
  let runtime = process.env.MUSIC_TOOLS_ELECTRON_DIST;
  if (!runtime) { try { runtime = path.dirname(require('electron')); } catch { throw new Error('Run npm install first, or set MUSIC_TOOLS_ELECTRON_DIST to an Electron 40.10.6 win32 x64 dist directory.'); } }
  runtime = path.resolve(runtime);
  if (!fs.existsSync(path.join(runtime, 'electron.exe'))) throw new Error('Electron runtime directory invalid: ' + runtime);
  if (fs.existsSync(out) && fs.lstatSync(out).isSymbolicLink()) throw new Error('Portable output must not be a symbolic link: ' + out);
  const beforeBytes = fs.existsSync(out) ? bytes(out, true) : null;
  fs.mkdirSync(out, { recursive: true });
  const desired = new Map();
  const legacy = new Set();
  for (const filename of walk(runtime)) {
    let relative = relativeFile(runtime, filename);
    legacy.add(relative === 'electron.exe' ? 'Music Tools.exe' : relative);
    if (relative === 'electron.exe') relative = 'Music Tools.exe';
    if (relative === 'resources/default_app.asar' || (relative.startsWith('locales/') && !locales.has(path.basename(relative)))) continue;
    desired.set(relative, filename);
  }
  for (const filename of walk(path.join(root, 'source'))) {
    const relative = 'resources/app/source/' + relativeFile(path.join(root, 'source'), filename);
    legacy.add(relative);
    if (includeSource(filename)) desired.set(relative, filename);
  }
  for (const name of ['README.md', 'THIRD-PARTY-NOTICES.md', 'CHANGELOG.md']) if (fs.existsSync(path.join(root, name))) { desired.set(name, path.join(root, name)); legacy.add(name); }
  // Electron's LICENSE stays alongside its executable; keep the application license separately.
  if (fs.existsSync(path.join(root, 'LICENSE'))) desired.set('LICENSE-Music-Tools', path.join(root, 'LICENSE'));
  for (const filename of walk(path.join(root, 'docs'))) {
    const relative = 'docs/' + relativeFile(path.join(root, 'docs'), filename);
    legacy.add(relative);
    if (isPublicDoc(relative)) desired.set(relative, filename);
  }
  desired.set('resources/app/package.json', null);
  desired.set('节省磁盘空间.cmd', path.join(root, 'scripts', 'compact-program.cmd'));
  legacy.add('resources/app/package.json');
  legacy.add('resources/installed-mode');
  legacy.add('docs/original-analysis.md');
  legacy.add('docs/real-library-test.md');
  legacy.add('docs/validation.md');
  // Recognize only obsolete bytecode in the generated source subtree on first migration.
  for (const filename of walk(path.join(out, 'resources', 'app', 'source'))) if (/\.py[co]$/i.test(filename)) legacy.add(relativeFile(out, filename));
  let previous = [];
  const inventoryPath = generatedPath(inventoryName);
  if (fs.existsSync(inventoryPath)) {
    const saved = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
    if (saved.format !== 1 || !Array.isArray(saved.files)) throw new Error('Invalid portable build inventory');
    previous = saved.files;
  }
  const removed = [];
  for (const relative of new Set([...legacy, ...previous])) {
    const target = generatedPath(relative);
    if (!desired.has(relative) && fs.existsSync(target)) {
      if (!fs.lstatSync(target).isFile()) throw new Error('Expected generated file: ' + target);
      fs.unlinkSync(target);
      removed.push(relative);
    }
  }
  for (const [relative, from] of desired) {
    const target = generatedPath(relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (from) fs.copyFileSync(from, target);
    else fs.writeFileSync(target, JSON.stringify({ name: manifest.name, productName: manifest.productName, version: manifest.version, main: manifest.main, description: manifest.description, license: manifest.license }, null, 2));
  }
  // The public README also opens locally beside the portable application.
  const readmePath = generatedPath('README.md');
  if (fs.existsSync(readmePath)) {
    const portableReadme = fs.readFileSync(readmePath, 'utf8')
      .replaceAll('src="source/', 'src="resources/app/source/')
      .replaceAll('](LICENSE)', '](LICENSE-Music-Tools)');
    fs.writeFileSync(readmePath, portableReadme);
  }
  // rcedit may replace the file atomically; all targets above are verified before editing.
  const executable = generatedPath('Music Tools.exe');
  const { rcedit } = await import('rcedit');
  await rcedit(executable, { icon: path.join(root, 'source/ui/assets/icon.ico'), 'file-version': manifest.version, 'product-version': manifest.version, 'version-string': { ProductName: 'Music Tools', FileDescription: 'Music Tools · 音乐整理工作台', OriginalFilename: 'Music Tools.exe', InternalName: 'MusicTools', CompanyName: 'Music Tools', LegalCopyright: 'Music Tools contributors' }, 'requested-execution-level': 'asInvoker' });
  fs.writeFileSync(inventoryPath, JSON.stringify({ format: 1, version: manifest.version, files: [...desired.keys()].sort() }, null, 2));
  fs.mkdirSync(path.join(out, 'data'), { recursive: true });
  fs.mkdirSync(path.join(root, 'artifacts'), { recursive: true });
  const afterBytes = bytes(out, true);
  const result = { version: manifest.version, electron: '40.10.6', architecture: 'win32-x64', builtAt: new Date().toISOString(), executableSHA256: crypto.createHash('sha256').update(fs.readFileSync(executable)).digest('hex'), output: out, size: { beforeBytes, afterBytes, savedBytes: beforeBytes === null ? null : beforeBytes - afterBytes, excludes: 'portable data directory' }, locales: ['en-US', 'zh-CN'], removedGeneratedFiles: removed };
  fs.writeFileSync(path.join(root, 'artifacts', 'release-build.json'), JSON.stringify(result, null, 2));
  console.log('Portable application: ' + executable);
  console.log('Portable bytes (excluding data): ' + afterBytes + (beforeBytes === null ? '' : '; previous ' + beforeBytes + '; saved ' + (beforeBytes - afterBytes)));
  console.log('No system Node.js or Python required. Portable user data is preserved in data/.');
  return result;
}
async function main() {
  const options = new Set(process.argv.slice(2));
  for (const option of options) if (!['--portable-only', '--installer-only'].includes(option)) throw new Error('Unknown package option: ' + option);
  if (options.has('--portable-only') && options.has('--installer-only')) throw new Error('Choose only one packaging mode');
  if (!options.has('--installer-only')) await buildPortable();
  if (!options.has('--portable-only')) await require('./installer.cjs').buildInstaller();
}
module.exports = { buildPortable, generatedPath, includeSource, bytes, isPublicDoc };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
