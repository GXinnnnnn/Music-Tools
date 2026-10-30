'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const sourceRoot = path.resolve(__dirname, '..');
let dataDir = path.resolve(sourceRoot, '..', 'data');
let pythonPath = null;
let mutationQueue = Promise.resolve();
const observed = new Map();

function setDataDir(dir) {
  if (!dir || typeof dir !== 'string') throw new TypeError('dataDir must be a directory path');
  dataDir = path.resolve(dir);
  return dataDir;
}
function setPythonPath(executable) {
  if (!executable || typeof executable !== 'string') throw new TypeError('pythonPath must be an executable path');
  pythonPath = path.resolve(executable);
  return pythonPath;
}
function resolvePython() {
  const candidates = [pythonPath, process.env.MUSIC_TOOLS_PYTHON,
    path.join(sourceRoot, 'vendor', 'python', 'python.exe'),
    path.join(sourceRoot, '..', 'vendor', 'python', 'python.exe'),
    path.join(sourceRoot, 'vendor', 'python', 'bin', 'python3')].filter(Boolean);
  const executable = candidates.find(candidate => fs.existsSync(candidate));
  if (!executable) throw new Error('找不到便携 Python runtime，请将 runtime 放入 source/vendor/python，或调用 setPythonPath。');
  return executable;
}
function bridge(command, payload = {}) {
  return new Promise((resolve, reject) => {
    let executable;
    try { executable = resolvePython(); } catch (error) { reject(error); return; }
    const child = spawn(executable, ['-X', 'utf8', path.join(__dirname, 'engine.py')], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' },
    });
    const stdout = [];
    const stderr = [];
    child.stdout.on('data', data => stdout.push(data));
    child.stderr.on('data', data => stderr.push(data));
    child.once('error', reject);
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') reject(error); });
    child.once('close', code => {
      const output = Buffer.concat(stdout).toString('utf8').replace(/^\uFEFF/, '');
      try {
        const response = JSON.parse(output);
        if (!response.ok) {
          const error = new Error(response.error?.message || 'Audio engine failed');
          error.code = response.error?.code || 'ENGINE_ERROR';
          reject(error);
        } else resolve(response.result);
      } catch (error) {
        if (error instanceof SyntaxError) reject(new Error(`Audio engine exited (${code}): ${Buffer.concat(stderr).toString('utf8').trim() || output.slice(0, 600)}`));
        else reject(error);
      }
    });
    child.stdin.end(JSON.stringify({ command, dataDir, ...payload }), 'utf8');
  });
}
function remember(record) {
  if (record?.path && record.stamp) observed.set(path.resolve(record.path).toLowerCase(), record.stamp);
  return record;
}
function prepare(jobs) {
  if (!Array.isArray(jobs)) throw new TypeError('jobs must be an array');
  return jobs.map(job => {
    const value = typeof job === 'string' ? { path: job } : { ...job };
    if (value.path && value.stamp === undefined) value.stamp = observed.get(path.resolve(value.path).toLowerCase());
    return value;
  });
}
function serial(action) {
  const next = mutationQueue.then(action, action);
  mutationQueue = next.catch(() => {});
  return next;
}
function rememberResults(result) {
  for (const item of result.results || []) remember(item.record);
  return result;
}
async function scan(paths) {
  const result = await bridge('scan', { paths: Array.isArray(paths) ? paths : [paths] });
  result.files.forEach(remember);
  return result;
}
async function read(filePath) { return remember(await bridge('read', { path: filePath })); }
function writeBatch(jobs, options = {}) {
  const prepared = prepare(jobs);
  return serial(async () => rememberResults(await bridge('writeBatch', { jobs: prepared, options })));
}
async function history() { return bridge('history'); }
function restore(id) {
  return serial(async () => {
    const result = await bridge('restore', { id });
    remember(result.record);
    return result;
  });
}
async function renamePreview(jobs, pattern) { return bridge('renamePreview', { jobs: prepare(jobs), pattern }); }
function renameBatch(jobs, pattern) {
  const prepared = prepare(jobs);
  return serial(async () => rememberResults(await bridge('renameBatch', { jobs: prepared, pattern })));
}
function exportSidecars(jobs, options = {}) {
  return serial(() => bridge('exportSidecars', { jobs: prepare(jobs), options }));
}

module.exports = { setDataDir, setPythonPath, scan, read, writeBatch, history, restore, renamePreview, renameBatch, exportSidecars };
