// Local-disk storage driver. Keys are relative paths such as
// "creatives/<sha256>.png"; anything that would leave the root is refused.

import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

export function createLocalStorage(root) {
  const base = path.resolve(root);

  function resolve(key) {
    const full = path.resolve(base, key);
    if (full !== base && !full.startsWith(base + path.sep)) throw new Error('Storage key escapes the media directory');
    return full;
  }

  return {
    root: base,

    // Writes to a temp file in the same directory, then renames, so readers
    // never see a partial file.
    async put(key, buffer) {
      const target = resolve(key);
      await fsp.mkdir(path.dirname(target), { recursive: true });
      const tmp = `${target}.${crypto.randomBytes(6).toString('hex')}.tmp`;
      try {
        await fsp.writeFile(tmp, buffer, { mode: 0o644 });
        await fsp.rename(tmp, target);
      } catch (err) {
        await fsp.rm(tmp, { force: true });
        throw err;
      }
    },

    // Returns { size, stream() } or null when the key does not exist.
    async get(key) {
      const target = resolve(key);
      try {
        const stat = await fsp.stat(target);
        if (!stat.isFile()) return null;
        return { size: stat.size, stream: () => fs.createReadStream(target) };
      } catch (err) {
        if (err.code === 'ENOENT') return null;
        throw err;
      }
    },

    async delete(key) {
      await fsp.rm(resolve(key), { force: true });
    },

    async exists(key) {
      try {
        return (await fsp.stat(resolve(key))).isFile();
      } catch {
        return false;
      }
    },
  };
}
