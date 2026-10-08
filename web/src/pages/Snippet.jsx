import { TriangleAlert } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { pickSizes } from '../../../embed/src/sizes.js';
import { sizeLabel } from '../lib/format.js';
import { useSession } from '../lib/session.js';
import { Checkbox, Slider } from '../ui/Controls.jsx';
import { Field } from '../ui/Field.jsx';
import { Card, CodeBlock, PageHeader } from '../ui/Misc.jsx';

function Step({ number, title, children }) {
  return (
    <section className="grid gap-4 border-t border-gray-400 py-8 md:grid-cols-[200px_minmax(0,1fr)] md:gap-8">
      <div>
        <p className="font-mono copy-12 text-gray-700">Step {number}</p>
        <h2 className="mt-1 heading-20">{title}</h2>
      </div>
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
    </section>
  );
}

// Shows which sizes the auto-sizer requests for a given container, using the
// same function ads.js ships with.
function SizePreview() {
  const [width, setWidth] = useState(728);
  const [tall, setTall] = useState(false);
  const sizes = pickSizes(width, tall ? 600 : 0);
  const first = sizes[0]?.split('x').map(Number);
  const scale = Math.min(1, 560 / width);
  return (
    <Card title="Auto-size preview" description="Pick a container width to see what an auto slot would request">
      <div className="grid gap-6 md:grid-cols-[240px_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <Field label={<>Container width <span className="ml-1 font-mono text-gray-1000 tabular">{width}px</span></>}>
            {(props) => <Slider {...props} value={width} onChange={setWidth} min={160} max={1200} step={2} />}
          </Field>
          <Checkbox checked={tall} onChange={setTall}>
            Parent is 600px tall
          </Checkbox>
          <div>
            <p className="copy-13 text-gray-900">Requested, best first</p>
            <ol className="mt-1 flex flex-wrap gap-x-3 font-mono copy-13 tabular" aria-live="polite">
              {sizes.length ? sizes.map((s, i) => <li key={s} className={i === 0 ? 'font-medium' : 'text-gray-900'}>{sizeLabel(s)}</li>) : <li className="text-gray-900">Nothing fits</li>}
            </ol>
          </div>
        </div>
        <div className="min-w-0 overflow-hidden rounded-md border border-gray-400 bg-background-200 p-4">
          {/* Scaled down to fit; the dashed box is the container, the solid box the ad. */}
          <div style={{ width: width * scale, height: (tall ? 600 : Math.max(first?.[1] || 60, 60)) * scale }} className="max-w-full rounded-[4px] border border-dashed border-gray-500 transition-[transform] duration-[200ms]">
            {first && (
              <div style={{ width: first[0] * scale, height: first[1] * scale }} className="grid place-items-center rounded-[4px] border border-blue-border bg-blue-soft font-mono copy-12 text-blue-text">
                {sizeLabel(sizes[0])}
              </div>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

export function Snippet() {
  const { config } = useSession();
  const { repo, version, sri } = config.embed;
  const major = (version || '1').split('.')[0];
  const base = `https://cdn.jsdelivr.net/gh/${repo}`;

  const install = `import { createAdsRouter } from '@55gms/ads-edge';

app.use('/_ads', createAdsRouter({
  adServerUrl: process.env.ADS_SERVER_URL,
  apiKey: process.env.ADS_API_KEY,
  flushIntervalMs: 60 * 60 * 1000,   // hourly
  manifestRefreshMs: 60 * 1000,
  spoolDir: process.env.ADS_SPOOL_DIR // durable buffer
}));`;

  const env = `ADS_SERVER_URL=${config.publicBaseUrl}
ADS_API_KEY=gms_live_...          # Settings → API keys
ADS_EDGE_SECRET=...               # same value on every instance
ADS_SPOOL_DIR=/var/lib/55gms-ads  # must survive restarts`;

  const script = `<script async src="${base}@${version}/embed/dist/ads.min.js"
        integrity="${sri}" crossorigin="anonymous"></script>`;

  const slots = `<div data-55gms-ad></div>                      <!-- auto size -->
<div data-55gms-ad data-size="728x90"></div>   <!-- fixed size -->`;

  const floating = `<script async src="${base}@${major}/embed/dist/ads.min.js"></script>`;

  return (
    <>
      <PageHeader title="Snippet" description="Two steps: mount the edge module on the 55GMS server, then paste one script tag into the shared template." />

      <Step number={1} title="Install the edge module">
        <p className="copy-14 text-gray-900">
          The edge module runs inside the 55GMS game server. It serves ads from a cached manifest on each site&rsquo;s own origin and reports stats here once an hour. Create a key under{' '}
          <Link to="/settings/keys" viewTransition className="text-blue-text underline-offset-2 hover:underline">
            Settings → API keys
          </Link>{' '}
          first.
        </p>
        <CodeBlock label="server.js" lang="js" code={install} />
        <CodeBlock label="Environment" lang="env" code={env} />
      </Step>

      <Step number={2} title="Add the script tag">
        <p className="copy-14 text-gray-900">
          Paste this once into the shared site template. It is pinned to version <span className="font-mono text-gray-1000">{version || 'unset'}</span> and verified with Subresource Integrity, so the browser refuses a file that differs from this release.
        </p>
        {sri ? (
          <CodeBlock label="Pinned, with SRI (recommended)" lang="html" code={script} />
        ) : (
          <p role="alert" className="flex items-start gap-2 rounded-md border border-amber-border bg-amber-soft p-3 copy-13 text-amber-text">
            <TriangleAlert size={16} strokeWidth={1.5} aria-hidden="true" className="mt-0.5 shrink-0" />
            No release hash is configured. Run npm run release:embed, then set EMBED_VERSION and EMBED_SRI on the ad server.
          </p>
        )}
        <CodeBlock label="Ad slots" lang="html" code={slots} />
        <div>
          <CodeBlock label={`Alternative: floating major version @${major}`} lang="html" code={floating} />
          <p className="mt-2 flex items-start gap-2 copy-13 text-amber-text">
            <TriangleAlert size={16} strokeWidth={1.5} aria-hidden="true" className="mt-0.5 shrink-0" />
            The floating URL picks up new {major}.x releases automatically, but it cannot use SRI, so the browser does not verify the file.
          </p>
        </div>
        <p className="copy-13 text-gray-900">
          The script calls <span className="font-mono">/_ads</span> on the page&rsquo;s own origin. If the edge module is mounted elsewhere, add <span className="font-mono">data-endpoint=&quot;/your-path&quot;</span> to the script tag.
        </p>
      </Step>

      <SizePreview />
    </>
  );
}
