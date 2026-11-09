'use strict';
// Manual build/dev entry only. Packaging and application startup never call this.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const projectRoot = path.resolve(__dirname, '..');
const helperPath = path.join(projectRoot, 'source', 'core', 'compact_program.py');
const pythonPath = path.join(projectRoot, 'source', 'vendor', 'python', 'python.exe');

function safecompact(root, { undo = false, algorithm = 'XPRESS8K', json = false } = {}) {
  if (typeof root !== 'string' || !root) throw new TypeError('An explicit portable root is required');
  if (algorithm !== 'XPRESS8K') throw new Error('Only XPRESS8K is supported');
  if (typeof undo !== 'boolean' || typeof json !== 'boolean') throw new TypeError('undo and json must be booleans');
  if (!fs.existsSync(pythonPath)) throw new Error('Embedded Python is missing; run node scripts/bootstrap-python.cjs first.');
  const args = ['-I', '-B', helperPath, '--root', path.resolve(root), '--algorithm', algorithm];
  if (undo) args.push('--undo');
  if (json) args.push('--json');
  const completed = spawnSync(pythonPath, args, {
    stdio: json ? ['ignore', 'pipe', 'pipe'] : ['ignore', 'inherit', 'inherit'],
    encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024,
  });
  if (completed.error) throw completed.error;
  let result = { exitCode: completed.status };
  if (json) {
    try { result = JSON.parse(completed.stdout); }
    catch { throw new Error('Compression helper did not return JSON: ' + (completed.stderr || completed.stdout || completed.status)); }
  }
  if (completed.status !== 0) {
    const error = new Error(result.error || `Compression helper failed with exit code ${completed.status}`);
    error.result = result;
    throw error;
  }
  return result;
}

module.exports = { safecompact, helperPath, pythonPath };
if (require.main === module) {
  const args = process.argv.slice(2);
  let root, undo = false, json = false, algorithm = 'XPRESS8K';
  try {
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--root' && args[i + 1]) root = args[++i];
      else if (args[i] === '--undo') undo = true;
      else if (args[i] === '--json') json = true;
      else if (args[i] === '--algorithm' && args[i + 1]) algorithm = args[++i];
      else if (args[i] === '--help' || args[i] === '-h') {
        console.log('Close Music Tools first. Manual optional NTFS compression; no administrator rights needed.\nUsage: node scripts/compact-program.cjs --root "PORTABLE_ROOT" [--undo] [--algorithm XPRESS8K] [--json]\n--undo restores ordinary program files. data/ and files outside the generated inventory are never selected.');
        process.exit(0);
      } else throw new Error('Unknown compact option: ' + args[i]);
    }
    if (!json) console.log('Close Music Tools before changing optional program compression.');
    const result = safecompact(root, { undo, algorithm, json });
    if (json) console.log(JSON.stringify(result));
  } catch (error) {
    if (json) console.log(JSON.stringify(error.result || { status: 'error', processed: 0, error: error.message }));
    else console.error(error.message);
    process.exitCode = 1;
  }
}
