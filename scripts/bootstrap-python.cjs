'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const version = '3.12.10';
const archiveName = `python-${version}-embed-amd64.zip`;
const downloadURL = `https://www.python.org/ftp/python/${version}/${archiveName}`;
// Measured from the existing official embedded archive in artifacts/, not inferred from a filename.
const archiveSHA256 = '4acbed6dd1c744b0376e3b1cf57ce906f9dc9e95e68824584c8099a63025a3c3';
const runtime = path.join(root, 'source', 'vendor', 'python');

function checkPython(directory = runtime) {
  const executable = path.join(directory, 'python.exe');
  if (!fs.existsSync(executable)) throw new Error('Embedded Python is missing. Run node scripts/bootstrap-python.cjs on Windows.');
  for (const name of ['python.exe', 'python312.dll', 'python312.zip', 'python312._pth', 'LICENSE.txt']) {
    const filename = path.join(directory, name);
    if (!fs.lstatSync(filename).isFile()) throw new Error('Invalid embedded Python file: ' + filename);
  }
  const result = spawnSync(executable, ['-I', '-B', '-c', 'import struct, sys; assert sys.version_info[:3] == (3, 12, 10), sys.version; assert struct.calcsize("P") == 8; print(sys.version.split()[0])'], { encoding: 'utf8', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error('Embedded Python validation failed: ' + (result.stderr || result.stdout || result.status));
  return executable;
}

async function ensurePython({ archive, checkOnly = false } = {}) {
  if (process.platform !== 'win32') throw new Error('The embedded Python runtime requires Windows x64.');
  if (fs.existsSync(runtime)) {
    if (fs.lstatSync(runtime).isSymbolicLink()) throw new Error('Embedded Python directory must not be a link: ' + runtime);
    return checkPython();
  }
  if (checkOnly) return checkPython();
  const vendor = path.dirname(runtime);
  fs.mkdirSync(vendor, { recursive: true });
  if (fs.lstatSync(vendor).isSymbolicLink()) throw new Error('Vendor directory must not be a link: ' + vendor);
  const temporary = fs.mkdtempSync(path.join(vendor, '.python-bootstrap-'));
  try {
    const local = archive ? path.resolve(archive) : path.join(root, 'artifacts', archiveName);
    let bytes;
    if (archive || fs.existsSync(local)) {
      bytes = fs.readFileSync(local);
      console.log('Checking embedded Python archive: ' + local);
    } else {
      console.log('Downloading ' + downloadURL);
      const response = await fetch(downloadURL, { signal: AbortSignal.timeout(120000) });
      if (!response.ok) throw new Error('Python download failed: HTTP ' + response.status);
      if (!response.url.startsWith('https://www.python.org/')) throw new Error('Unexpected Python download origin: ' + response.url);
      bytes = Buffer.from(await response.arrayBuffer());
    }
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    if (digest !== archiveSHA256) throw new Error(`Python archive SHA-256 mismatch: expected ${archiveSHA256}, received ${digest}`);
    const zip = path.join(temporary, archiveName);
    const extracted = path.join(temporary, 'runtime');
    fs.writeFileSync(zip, bytes, { flag: 'wx' });
    // The official archive is authenticated before extraction. Pass paths as environment data, not shell text.
    const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference = 'Stop'; Expand-Archive -LiteralPath $env:MT_PYTHON_ZIP -DestinationPath $env:MT_PYTHON_EXTRACT"], { stdio: 'inherit', windowsHide: true, env: { ...process.env, MT_PYTHON_ZIP: zip, MT_PYTHON_EXTRACT: extracted } });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error('Python extraction failed with exit code ' + result.status);
    checkPython(extracted);
    if (fs.existsSync(runtime)) throw new Error('Embedded Python destination appeared during bootstrap; no files were replaced.');
    fs.renameSync(extracted, runtime);
    console.log(`Embedded Python ${version} x64 ready: ${runtime}`);
    return checkPython();
  } finally {
    const resolved = path.resolve(temporary);
    if (path.dirname(resolved) !== vendor || !path.basename(resolved).startsWith('.python-bootstrap-') || fs.lstatSync(resolved).isSymbolicLink()) throw new Error('Unsafe bootstrap temporary directory: ' + resolved);
    fs.rmSync(resolved, { recursive: true, force: true });
  }
}

module.exports = { ensurePython, checkPython, version, archiveName, archiveSHA256, downloadURL };
if (require.main === module) {
  const args = process.argv.slice(2);
  let archive, checkOnly = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--check') checkOnly = true;
    else if (args[i] === '--archive' && args[i + 1]) archive = args[++i];
    else throw new Error('Unknown bootstrap option: ' + args[i]);
  }
  ensurePython({ archive, checkOnly }).then(executable => console.log('Python runtime: ' + executable)).catch(error => { console.error(error); process.exitCode = 1; });
}
