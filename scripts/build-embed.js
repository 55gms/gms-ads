// Bundles the browser scripts into embed/dist and records each file's
// Subresource Integrity hash in embed/dist/manifest.json:
//   ads.min.js    the page script (image slots; loads video.min.js on demand)
//   video.min.js  video player, providers, rewarded flow, iframe bridge host
//   sdk.min.js    the game SDK (window.GMSAds)
// video.min.js is built first so the other two can pin its hash.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'embed/dist');

// gzipped byte budgets; ads.js runs on every page, so it stays tiny.
const BUNDLES = [
  { name: 'video', entry: 'embed/src/video/index.js', maxGzip: 16 * 1024 },
  { name: 'ads', entry: 'embed/src/ads.js', maxGzip: 4096 },
  { name: 'sdk', entry: 'embed/src/sdk/index.js', maxGzip: 5 * 1024 },
];

const sri = (code) => `sha384-${crypto.createHash('sha384').update(code).digest('base64')}`;

export async function buildEmbed() {
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'embed/package.json'), 'utf8'));
  const files = {};
  for (const bundle of BUNDLES) {
    const outfile = path.join(outDir, `${bundle.name}.min.js`);
    await build({
      entryPoints: [path.join(root, bundle.entry)],
      outfile,
      bundle: true,
      minify: true,
      format: 'iife',
      target: ['es2017'],
      legalComments: 'none',
      define: { __VIDEO_SRI__: JSON.stringify(files.video?.integrity || '') },
      banner: { js: `/*! 55GMS ${bundle.name}.js v${version} */` },
    });
    const code = fs.readFileSync(outfile);
    const gzipBytes = zlib.gzipSync(code, { level: 9 }).length;
    files[bundle.name] = { file: `embed/dist/${bundle.name}.min.js`, bytes: code.length, gzipBytes, integrity: sri(code) };
    if (gzipBytes > bundle.maxGzip) throw new Error(`${bundle.name}.min.js is ${gzipBytes} bytes gzipped; the limit is ${bundle.maxGzip}`);
  }
  // Top-level fields describe ads.js, as before, so existing readers keep working.
  const manifest = { version, ...files.ads, files };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const manifest = await buildEmbed();
  for (const [name, f] of Object.entries(manifest.files)) console.log(`${name}.min.js v${manifest.version}: ${f.bytes} bytes, ${f.gzipBytes} gzipped  ${f.integrity}`);
}
