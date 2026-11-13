'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const { isPublicDoc, generatedPath } = require('./package.cjs');
const { ensurePython } = require('./bootstrap-python.cjs');
const rootFiles = new Set(['.gitignore', 'README.md', 'THIRD-PARTY-NOTICES.md', 'LICENSE', 'CHANGELOG.md', 'package.json', 'package-lock.json', '启动 Music Tools.cmd']);
const publicScripts = new Set(['bootstrap-python.cjs', 'bootstrap-tests.cjs', 'public-release.cjs', 'package.cjs', 'installer.cjs', 'installer.nsh', 'installer-check.cjs', 'package-check.cjs', 'release-check.cjs', 'render-icon.cjs', 'screenshots.cjs', 'create-demo.py', 'engine-fixtures.py', 'providers-live-check.cjs', 'ui-batch-check.cjs', 'ui-check.cjs', 'ui-policy-check.cjs', 'ui-tools-check.cjs', 'ui-lyrics-check.cjs', 'lyrics-live-check.cjs', 'workspace-check.cjs', 'ui-lyric-result-check.cjs', 'performance-check.cjs', 'compact-program.cjs', 'compact-program.cmd', 'ui-focus-check.cjs', 'ui-lyric-reference-check.cjs', 'ui-batch-write-check.cjs', 'ui-batch-stream-check.cjs', 'ui-theme-check.cjs']);

function safeRelative(relative) {
  if (typeof relative !== 'string' || relative.includes('\\') || /[:\x00-\x1f]/.test(relative) || relative.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part))) throw new Error('Unsafe archive entry: ' + relative);
  return relative;
}
function publicSource(relative) {
  safeRelative(relative);
  const parts = relative.split('/');
  if (parts.some(part => /^(?:node_modules|data|__pycache__|\.git|\.pytest_cache)$/i.test(part)) || /(?:\.py[co]|\.log|\.bak|\.tmp)$/i.test(relative)) return false;
  if (rootFiles.has(relative) || isPublicDoc(relative)) return true;
  if (parts[0] === 'scripts') return parts.length === 2 && publicScripts.has(parts[1]);
  if (parts[0] === 'source') {
    if (parts.some(part => part.startsWith('.'))) return false;
    if (parts[1] === 'vendor') {
      if (parts[2] !== 'python-libs') return false;
      return (parts[3] === 'mutagen' && /\.(?:py|typed)$/.test(relative)) || (parts[3] === 'mutagen-1.48.1.dist-info' && /\/(?:METADATA|WHEEL|entry_points\.txt|top_level\.txt|licenses\/COPYING)$/.test(relative));
    }
    if (parts.length === 2) return ['main.cjs', 'preload.cjs'].includes(parts[1]);
    if (parts[1] === 'core') return parts.length === 3 && /\.(?:cjs|py|md)$/.test(relative);
    if (parts[1] === 'ui') return /\.(?:html|css|js|svg|png|ico)$/.test(relative);
    return parts[1] === 'demo' && parts.length === 3 && /^(?:0[1-8]) - .+\.wav$/.test(parts[2]);
  }
  if (parts[0] !== 'tests') return false;
  return parts.length === 2 && /\.(?:cjs|py)$/.test(parts[1]);
}
function resolvedFile(base, relative) {
  safeRelative(relative);
  const target = path.resolve(base, ...relative.split('/'));
  if (!target.startsWith(base + path.sep)) throw new Error('Archive path escaped input: ' + relative);
  for (let current = target; current !== base; current = path.dirname(current)) if (fs.lstatSync(current).isSymbolicLink()) throw new Error('Archive inputs must not traverse links: ' + current);
  if (!fs.lstatSync(target).isFile()) throw new Error('Archive input must be a regular file: ' + target);
  return target;
}
function stagingFiles(base, relative = '') {
  const files = [];
  // Traverse only public roots. Private music, testing and artifact directories are never opened.
  const roots = new Set(['source', 'scripts', 'tests', 'docs', '.github']);
  for (const entry of fs.readdirSync(path.join(base, relative), { withFileTypes: true })) {
    const name = relative ? relative + '/' + entry.name : entry.name;
    if (entry.isDirectory()) {
      if (!relative && !roots.has(entry.name)) continue;
      if (/^(?:node_modules|data|__pycache__|\.git|\.pytest_cache)$/i.test(entry.name)) continue;
      if (name === 'source/vendor/python' || name === 'source/vendor/python-libs/bin' || name === 'tests/core-tools' || name === '.github/workflows' || /^source\/vendor\/\.python-bootstrap-/.test(name)) continue;
      if (name.startsWith('docs/') && name !== 'docs/images') continue;
      files.push(...stagingFiles(base, name));
    } else if (publicSource(name)) {
      if (entry.isSymbolicLink()) throw new Error('Archive inputs must not be links: ' + name);
      files.push(name);
    }
  }
  return files;
}
function sourceEntries(base, staging) {
  if (fs.lstatSync(base).isSymbolicLink()) throw new Error('Source input must not be a link: ' + base);
  let files;
  if (staging) files = stagingFiles(base);
  else {
    const result = spawnSync('git', ['-C', base, 'ls-files', '-z', '--cached'], { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('Source archives require a Git repository or --staging <directory>: ' + result.stderr.trim());
    files = result.stdout.split('\0').filter(Boolean).filter(publicSource);
  }
  const names = [...new Set(files)].sort();
  for (const required of ['README.md', 'THIRD-PARTY-NOTICES.md', 'LICENSE', 'CHANGELOG.md', 'package.json', 'package-lock.json', '.gitignore', 'source/main.cjs', 'source/vendor/python-libs/mutagen/__init__.py', 'source/vendor/python-libs/mutagen-1.48.1.dist-info/licenses/COPYING', 'scripts/package.cjs', 'scripts/installer.cjs', 'scripts/installer.nsh', 'scripts/public-release.cjs', 'scripts/bootstrap-python.cjs', 'docs/distribution.md']) {
    if (!names.includes(required)) throw new Error('Public source input is incomplete: ' + required);
  }
  const caseNames = new Set();
  return names.map(name => {
    if (caseNames.has(name.toLowerCase())) throw new Error('Case-colliding source entry: ' + name);
    caseNames.add(name.toLowerCase());
    const filename = resolvedFile(base, name);
    if (fs.statSync(filename).size >= 100 * 1024 * 1024) throw new Error('Public source file exceeds GitHub\'s 100 MiB limit: ' + name);
    return { name, filename };
  });
}
function portableEntries(version) {
  const portable = path.join(root, 'release', 'Music Tools');
  for (const directory of [path.dirname(portable), portable]) if (fs.lstatSync(directory).isSymbolicLink()) throw new Error('Portable input must not traverse a link: ' + directory);
  const inventory = JSON.parse(fs.readFileSync(resolvedFile(portable, '.music-tools-generated.json'), 'utf8'));
  if (inventory.format !== 1 || inventory.version !== version || !Array.isArray(inventory.files)) throw new Error('Portable build is missing or stale; run node scripts/package.cjs first.');
  const names = [...new Set(inventory.files)].sort();
  if (!names.includes('Music Tools.exe') || !names.includes('resources/app/package.json')) throw new Error('Portable inventory is incomplete');
  if (JSON.parse(fs.readFileSync(generatedPath('resources/app/package.json'), 'utf8')).version !== version) throw new Error('Portable manifest version is stale');
  const caseNames = new Set();
  return names.map(name => {
    safeRelative(name);
    if (caseNames.has(name.toLowerCase())) throw new Error('Case-colliding portable entry: ' + name);
    caseNames.add(name.toLowerCase());
    if (name === 'resources/installed-mode' || name.split('/').some(part => /^(?:data|__pycache__)$/i.test(part)) || (name.startsWith('docs/') && !isPublicDoc(name))) throw new Error('Non-public portable inventory entry; rebuild first: ' + name);
    const filename = generatedPath(name);
    if (!fs.lstatSync(filename).isFile()) throw new Error('Missing portable generated file: ' + name);
    return { name, filename };
  }).concat([{ name: '.music-tools-generated.json', filename: resolvedFile(portable, '.music-tools-generated.json') }]);
}
function createZip(python, entries, prefix, output) {
  const temporary = output + '.partial-' + crypto.randomBytes(8).toString('hex');
  if (fs.existsSync(output) && !fs.lstatSync(output).isFile()) throw new Error('Archive output must be a regular file: ' + output);
  const program = [
    'import json, shutil, sys, zipfile',
    'items = json.load(sys.stdin)',
    'with zipfile.ZipFile(sys.argv[1], "x", compression=zipfile.ZIP_DEFLATED, compresslevel=9, allowZip64=True) as archive:',
    ' for item in items:',
    '  info = zipfile.ZipInfo(sys.argv[2] + "/" + item["name"], date_time=(2020, 1, 1, 0, 0, 0))',
    '  info.compress_type = zipfile.ZIP_DEFLATED',
    '  info.create_system = 3',
    '  info.external_attr = 0o100644 << 16',
    '  info._compresslevel = 9',
    '  with open(item["filename"], "rb") as source, archive.open(info, "w", force_zip64=True) as target:',
    '   shutil.copyfileobj(source, target, 1024 * 1024)',
    'with zipfile.ZipFile(sys.argv[1]) as archive:',
    ' assert archive.testzip() is None, "ZIP integrity validation failed"',
    ' assert len(archive.infolist()) == len(items), "ZIP inventory mismatch"',
    ' assert all(item.compress_type == zipfile.ZIP_DEFLATED for item in archive.infolist()), "ZIP must be compressed"',
  ].join('\n');
  try {
    const result = spawnSync(python, ['-I', '-B', '-X', 'utf8', '-c', program, temporary, prefix], { input: JSON.stringify(entries), encoding: 'utf8', windowsHide: true, maxBuffer: 1024 * 1024 });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('ZIP creation failed: ' + (result.stderr || result.stdout || result.status));
    // Replace only this exact generated archive after the new ZIP passes its integrity check.
    if (fs.existsSync(output)) fs.unlinkSync(output);
    fs.renameSync(temporary, output);
  } finally {
    if (path.dirname(temporary) !== path.join(root, 'release') || !path.basename(temporary).startsWith(path.basename(output) + '.partial-')) throw new Error('Unsafe temporary archive path');
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
  console.log('Verified ZIP: ' + output + ' (' + entries.length + ' files)');
}
async function sha256(filename) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
  return hash.digest('hex');
}
async function main(args = process.argv.slice(2)) {
  let staging, sourceOnly = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--staging' && args[i + 1]) staging = path.resolve(args[++i]);
    else if (args[i] === '--source-only') sourceOnly = true;
    else throw new Error('Unknown public-release option: ' + args[i]);
  }
  const base = staging || root;
  const manifest = JSON.parse(fs.readFileSync(path.join(base, 'package.json'), 'utf8'));
  const version = manifest.version;
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('Unsafe release version: ' + version);
  if (!sourceOnly && require('../package.json').version !== version) throw new Error('Staging and built application versions differ');
  const source = sourceEntries(base, Boolean(staging));
  const portable = sourceOnly ? null : portableEntries(version);
  const setup = path.join(root, 'release', `Music Tools Setup ${version} x64.exe`);
  if (!sourceOnly && !fs.lstatSync(setup).isFile()) throw new Error('Build the Windows installer before preparing the complete release');
  const release = path.join(root, 'release');
  if (fs.existsSync(release) && fs.lstatSync(release).isSymbolicLink()) throw new Error('Release output must not be a link');
  fs.mkdirSync(release, { recursive: true });
  const python = await ensurePython();
  const outputs = [];
  const sourceZIP = path.join(release, `Music-Tools-${version}-Source.zip`);
  createZip(python, source, `Music-Tools-${version}`, sourceZIP);
  outputs.push(sourceZIP);
  if (portable) {
    const portableZIP = path.join(release, `Music-Tools-${version}-Portable-x64.zip`);
    createZip(python, portable, 'Music Tools', portableZIP);
    const publicSetup = path.join(release, `Music-Tools-${version}-Setup-x64.exe`);
    if (fs.existsSync(publicSetup) && !fs.lstatSync(publicSetup).isFile()) throw new Error('Installer output must be a regular file');
    fs.copyFileSync(setup, publicSetup);
    outputs.push(portableZIP, publicSetup);
  }
  const checksums = [];
  for (const filename of outputs) checksums.push(`${await sha256(filename)}  ${path.basename(filename)}`);
  const checksumFile = path.join(release, sourceOnly ? `Music-Tools-${version}-Source-SHA256SUMS.txt` : 'SHA256SUMS.txt');
  if (fs.existsSync(checksumFile) && !fs.lstatSync(checksumFile).isFile()) throw new Error('Checksum output must be a regular file');
  fs.writeFileSync(checksumFile, checksums.join('\n') + '\n');
  console.log('Checksums: ' + checksumFile);
  return { version, sourceFiles: source.length, portableFiles: portable?.length || 0, outputs: [...outputs, checksumFile] };
}
module.exports = { main, publicSource, sourceEntries, portableEntries, safeRelative };
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
