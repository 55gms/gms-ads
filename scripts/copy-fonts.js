// Copies the Geist variable fonts from the `geist` package into the SPA's
// public folder so they are self-hosted and can be preloaded from index.html.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'web/public/fonts');
const fonts = ['geist-sans/Geist-Variable.woff2', 'geist-mono/GeistMono-Variable.woff2'];

fs.mkdirSync(out, { recursive: true });
for (const font of fonts) {
  fs.copyFileSync(path.join(root, 'node_modules/geist/dist/fonts', font), path.join(out, path.basename(font)));
}
