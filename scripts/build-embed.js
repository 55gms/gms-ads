// Bundles embed/src/ads.js into embed/dist/ads.min.js and records its
// Subresource Integrity hash in embed/dist/manifest.json.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'embed/dist');
const outFile = path.join(outDir, 'ads.min.js');
const MAX_GZIP_BYTES = 4096;

export async function buildEmbed() {
  const { version } = JSON.parse(fs.readFileSync(path.join(root, 'embed/package.json'), 'utf8'));
  await build({
    entryPoints: [path.join(root, 'embed/src/ads.js')],
    outfile: outFile,
    bundle: true,
    minify: true,
    format: 'iife',
    target: ['es2017'],
    legalComments: 'none',
    banner: { js: `/*! 55GMS ads.js v${version} */` },
  });
  const code = fs.readFileSync(outFile);
  const gzipBytes = zlib.gzipSync(code, { level: 9 }).length;
  const integrity = `sha384-${crypto.createHash('sha384').update(code).digest('base64')}`;
  const manifest = { version, file: 'embed/dist/ads.min.js', bytes: code.length, gzipBytes, integrity };
  fs.writeFileSync(path.join(outDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  if (gzipBytes > MAX_GZIP_BYTES) {
    throw new Error(`ads.min.js is ${gzipBytes} bytes gzipped; the limit is ${MAX_GZIP_BYTES}`);
  }
  return manifest;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const manifest = await buildEmbed();
  console.log(`Built ads.min.js v${manifest.version}: ${manifest.bytes} bytes, ${manifest.gzipBytes} gzipped`);
  console.log(manifest.integrity);
}
