// Runs the API (with reload on change) and the Vite dev server together.

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
await import('./copy-fonts.js');

const run = (args) => spawn(process.execPath, args, { cwd: root, stdio: 'inherit', env: process.env });
const children = [
  run(['--watch-path=server', '--watch-path=shared', '--watch-path=edge/lib', 'server/index.js']),
  run(['node_modules/vite/bin/vite.js', '--config', 'web/vite.config.js']),
];

const stop = () => children.forEach((child) => child.kill('SIGTERM'));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
children.forEach((child) => child.on('exit', (code) => {
  stop();
  process.exitCode ||= code ?? 0;
}));
