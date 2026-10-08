// Builds ads.js, writes embed/dist/manifest.json, and prints the commands
// that publish the release for jsDelivr. It does not tag or push by itself.

import { buildEmbed } from './build-embed.js';

const repo = process.env.EMBED_REPO || '55gms/gms-ads';
const manifest = await buildEmbed();
const { version, integrity } = manifest;
const major = version.split('.')[0];

console.log(`
ads.js v${version} built (${manifest.gzipBytes} bytes gzipped)

1. Commit the build and tag it:

   git add embed/dist embed/package.json
   git commit -m "build(embed): release ads.js v${version}"
   git tag v${version}
   git push origin main v${version}

2. Set these on the ad server (Coolify environment variables), then redeploy:

   EMBED_REPO=${repo}
   EMBED_VERSION=${version}
   EMBED_SRI=${integrity}

3. Pinned snippet (recommended):

   <script async src="https://cdn.jsdelivr.net/gh/${repo}@${version}/embed/dist/ads.min.js"
           integrity="${integrity}" crossorigin="anonymous"></script>

   Floating major, no SRI: https://cdn.jsdelivr.net/gh/${repo}@${major}/embed/dist/ads.min.js

To cut the next version, bump "version" in embed/package.json first.
`);
