'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

function createPreferences(dataDir) {
  const filename = path.join(dataDir, 'preferences.json');
  let value = { backupEnabled: true }, queue = Promise.resolve();
  const ready = fs.readFile(filename, 'utf8').then(text => {
    const saved = JSON.parse(text);
    if (typeof saved?.backupEnabled === 'boolean') value = { backupEnabled: saved.backupEnabled };
  }).catch(error => {
    if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
  });
  return {
    async get() { await ready; await queue; return { ...value }; },
    set(patch) {
      if (!patch || typeof patch.backupEnabled !== 'boolean') return Promise.reject(new TypeError('备份设置必须为开启或关闭'));
      const next = queue.catch(() => {}).then(async () => {
        await ready;
        const updated = { backupEnabled: patch.backupEnabled }, temporary = filename + '.tmp';
        await fs.mkdir(dataDir, { recursive: true });
        try {
          await fs.writeFile(temporary, JSON.stringify(updated, null, 2), { encoding: 'utf8', mode: 0o600 });
          await fs.rename(temporary, filename);
        } catch (error) { await fs.unlink(temporary).catch(() => {}); throw error; }
        value = updated;
        return { ...value };
      });
      queue = next.catch(() => {});
      return next;
    },
  };
}
module.exports = { createPreferences };
