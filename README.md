# 55GMS Ads

Self-hosted ad server and ad manager for 55GMS. One script tag in the shared site template serves correctly sized ads on every 55GMS domain. Admins sign in with Authometry, upload creatives, run several weighted campaigns at once, and see impressions, clicks, CTR, and per-domain breakdowns.

```
Browser ──ads.js (jsDelivr)──▶ 55GMS server /_ads/*  ──(manifest pull, ~1 min)──▶ Ad server
                                       │                                               ▲
                                       └──────── hourly batch of stats (POST) ─────────┘
```

Browsers never talk to the ad server, except to load uploaded images from `/media`. The 55GMS game server mounts the edge module, which serves from a cached manifest and reports hourly aggregates.

| Path | What it is |
|---|---|
| `server/` | Express app: admin API, manifest and batch ingestion, media, Authometry sign-in |
| `web/` | Admin dashboard (Vite, React 19, React Router 7, Tailwind 4) |
| `edge/` | `@55gms/ads-edge`, the router the 55GMS server mounts. Node built-ins only |
| `shared/` | Selection logic and request validators |
| `embed/` | `ads.js` source and the committed build in `embed/dist/` that jsDelivr serves |
| `scripts/` | Dev runner, font copy, embed build and release |

## Status

- **Production runs at https://ads.ch3n.cc** on Coolify (project *55GMS*, environment *production*, application `gms-ads`, database `gms-ads-db`, media volume at `/data/media`).
- **`ads.js` 1.0.0 is tagged (`v1.0.0`) and served by jsDelivr**; the published file matches the SRI hash in `embed/dist/manifest.json`.
- **The API was exercised end to end against a real Postgres**: migration, creative upload and resize, media caching and WebP negotiation, manifest and 304, gzip batch ingestion, idempotent replay, rejected batches, stats queries, CSV export, roles, CSRF, and refresh-token rotation with reuse detection. The edge module was exercised against a fake ad server (dedupe, forged IDs, bots, local caps, outage spool, crash recovery, in-order resend). These were manual runs, not a kept suite.
- **No automated tests.** The brief asked for a `node --test` suite; that was dropped on request, so there is no `npm test`.
- **The dashboard has not been viewed in a browser.** It builds, lints, and is served in production; layout and motion have not been checked visually, and the Authometry sign-in round trip has not been completed by a person yet.
- **A development database** `gms-ads-dev-db` exists in Coolify (environment *ads-development*) and is exposed on a public port so it can be reached from a laptop. Make it private again in Coolify when it is not needed.

## Local development

Requirements: Node 22+, a Postgres 14+ database.

```bash
npm install
cp .env.example .env          # set DATABASE_URL; SESSION_SECRET is optional in development
npm run migrate               # applies server/db/migrations/*.sql (also runs on server start)
npm run dev                   # dashboard on http://localhost:3000, API on :3001
```

`.env.local` already holds the Authometry credentials for the `55GMS Ads` application and is loaded before `.env`. It is gitignored. In development Vite owns port 3000, because that is the registered OAuth redirect origin, and proxies `/api`, `/auth`, `/media`, and `/healthz` to Express on `API_PORT`.

The first account to sign in becomes `owner`. Later accounts land as `pending` until an owner or admin approves them under Settings → Members.

With Docker:

```bash
cp .env.example .env          # set SESSION_SECRET and the AUTHOMETRY_* values (or keep .env.local)
docker compose up --build     # app on http://localhost:3000, Postgres, named volumes for both
```

### Scripts

| Script | Does |
|---|---|
| `npm run dev` | API with reload plus the Vite dev server |
| `npm run build` | Copies the Geist fonts and builds the SPA into `web/dist` |
| `npm start` | Runs migrations, then serves the API and the built SPA on `PORT` |
| `npm run migrate` | Applies pending SQL migrations |
| `npm run lint` | ESLint 9 |
| `npm run build:embed` | Builds `embed/dist/ads.min.js` and `manifest.json` |
| `npm run release:embed` | Builds, computes the SRI hash, prints the tag commands |

## Environment variables

`.env.example` documents every variable. The ones that matter in production:

| Variable | Purpose |
|---|---|
| `PUBLIC_BASE_URL` | Public origin of the ad server, no trailing slash. Used for absolute image URLs and the OAuth redirect URI |
| `DATABASE_URL` | Postgres connection string. Without it the standard `PG*` variables are used |
| `PGSSLMODE` | `require` for TLS without certificate verification; otherwise `disable` |
| `SESSION_SECRET` | 32+ random characters. Signs access tokens and encrypts the sign-in attempt cookie. Required in production |
| `AUTHOMETRY_ISSUER`, `AUTHOMETRY_CLIENT_ID`, `AUTHOMETRY_CLIENT_SECRET` | The OAuth client (see below) |
| `AUTHOMETRY_PROVIDER_LOGOUT` | `true` to also end the Authometry session on sign-out |
| `ADMIN_EMAILS` | Comma-separated emails approved as `admin` on first sign-in (verified emails only) |
| `MEDIA_DIR` | Where uploads are stored. Default `/data/media`. Must be a persistent volume |
| `EXTERNAL_IMAGE_HOSTS` | Allowed hosts for external creative URLs. Default `cdn.jsdelivr.net`. Empty allows any public https host |
| `TRUST_PROXY` | Number of proxies in front of the app. `1` behind Coolify's proxy, so rate limits see real client IPs |
| `EMBED_REPO`, `EMBED_VERSION`, `EMBED_SRI` | What the Snippet page generates. Falls back to `embed/dist/manifest.json` |

Never put `AUTHOMETRY_TOKEN` (the management token) in the app's environment. The app does not use it.

## Authometry

The OAuth client is already provisioned:

- Application: **55GMS Ads** (`55gms-ads`), ID `4a6f59b7-a184-4f9e-99c3-91613131b751`
- Type: confidential `web` client, Authorization Code with S256 PKCE, `client_secret_basic`
- Environment: Authometry Cloud `production`, issuer `https://authometry.ch3n.cc`
- Scopes: `openid profile email`
- Redirect URI: `http://localhost:3000/auth/callback`; post-logout: `http://localhost:3000/`

It was created through the Authometry management API (the connected MCP server) rather than `npx authometry apps create`, because no `AUTHOMETRY_TOKEN` was available. The result is the same application; do not run the CLI `create` as well.

`https://ads.ch3n.cc/auth/callback` and `https://ads.ch3n.cc/` are registered as well, for production.

To add another domain, add `https://<domain>/auth/callback` to the redirect URIs and `https://<domain>/` to the post-logout URIs, and set `PUBLIC_BASE_URL` to match. The Authometry CLI (0.1.2) only has `apps create`, so use the Authometry dashboard (Applications → 55GMS Ads → Redirect URIs) or the management API: `PATCH /applications/4a6f59b7-a184-4f9e-99c3-91613131b751` with the current `version` and the full `redirectUris` and `postLogoutRedirectUris` lists.

How sign-in works: `/auth/login` creates a fresh `state`, `nonce`, and PKCE verifier, stores them in an encrypted, HTTP-only, `SameSite=Lax` cookie that lives ten minutes, and redirects to Authometry. `/auth/callback` consumes that cookie once, and `openid-client` validates the ID token's signature, issuer, audience, expiry, and nonce. Users are keyed on `(iss, sub)`. The app then issues its own session: a 15-minute access JWT and a 30-day refresh token, both HTTP-only cookies. Refresh tokens are stored hashed, rotated on every use, and the whole family is revoked if a rotated token is presented again. Sign-out is a CSRF-protected POST.

## Deploying on Coolify

1. Create a Postgres database in Coolify and copy its internal connection URL.
2. Create an application from this repository with the **Dockerfile** build pack. The container listens on port 3000. Leave Coolify's own health check **off**: it probes with `curl` or `wget`, which the slim image does not include, and the deploy is rolled back as unhealthy. The Dockerfile's `HEALTHCHECK` calls `/healthz` with Node instead.
3. **Add persistent storage** mounted at `/data/media` (Storages → Add → Volume). Uploaded creatives live there; without the volume they are lost on every redeploy. If you change `MEDIA_DIR`, mount the volume at that path instead. Use a named volume rather than a host bind mount: the container runs as the unprivileged `node` user and a bind mount would be owned by root.
4. Set the environment variables: `PUBLIC_BASE_URL`, `DATABASE_URL`, `SESSION_SECRET`, the three `AUTHOMETRY_*` values from `.env.local`, `TRUST_PROXY=1`, and the `EMBED_*` values from the latest release.
5. Make sure the domain's redirect URI is registered in Authometry (see above), then deploy. Migrations run on start.

There is no CDN in front of the app. Uploaded files are served from `/media/creatives/<sha256>.<ext>` with `Cache-Control: public, max-age=31536000, immutable` and a strong `ETag`, so Coolify's proxy, or Cloudflare in front of the domain, can cache them indefinitely. A WebP variant is served when the browser's `Accept` header allows it.

## Installing on the 55GMS server

Create a key under **Settings → API keys** and copy it; it is shown once.

### 1. Mount the edge module

`edge/` has no dependencies. Until it is published to npm, either copy the `edge/` directory into the 55GMS server repository or install a tarball built with `npm pack ./edge`.

```js
import { createAdsRouter } from '@55gms/ads-edge';

app.use('/_ads', createAdsRouter({
  adServerUrl: process.env.ADS_SERVER_URL,
  apiKey: process.env.ADS_API_KEY,
  flushIntervalMs: 60 * 60 * 1000,   // hourly
  manifestRefreshMs: 60 * 1000,
  spoolDir: process.env.ADS_SPOOL_DIR // durable buffer
}));
```

| Variable | Value |
|---|---|
| `ADS_SERVER_URL` | The ad server's `PUBLIC_BASE_URL` |
| `ADS_API_KEY` | The key from Settings → API keys |
| `ADS_EDGE_SECRET` | Any long random string, identical on every instance. Signs serve IDs |
| `ADS_SPOOL_DIR` | A directory that survives restarts |

If the 55GMS server sits behind a proxy that rewrites `Host`, pass `trustForwardedHost: true` so the edge reads `X-Forwarded-Host`. The router exposes `getStats()` for health checks and `flush()` to send stats immediately. See `edge/README.md` for all options.

### 2. Paste the snippet

The Snippet page in the dashboard generates this with the current version and hash:

```html
<script async src="https://cdn.jsdelivr.net/gh/55gms/gms-ads@1.0.0/embed/dist/ads.min.js"
        integrity="sha384-..." crossorigin="anonymous"></script>
<div data-55gms-ad></div>                      <!-- auto size -->
<div data-55gms-ad data-size="728x90"></div>   <!-- fixed size -->
```

Because the script only calls `/_ads/*` on the page's own origin, the same tag works on every domain with no CORS. Register the domains under **Domains** (bulk paste, `*.example.com` wildcards supported): the edge serves nothing on hosts that are not registered and enabled.

### Trying it end to end locally

```bash
ADS_SERVER_URL=http://localhost:3000 ADS_API_KEY=gms_live_... ADS_EDGE_SECRET=dev node edge/example/server.js
```

`localhost` cannot be registered as a domain (a hostname needs a dot), so add an entry such as `ads.test` to `/etc/hosts`, register `ads.test` under Domains, and open `http://ads.test:4000`. Stats normally arrive at the top of the hour; to send them now:

```bash
curl -X POST http://ads.test:4000/_debug/flush
```

The batch then appears under Settings → Ingestion and in Analytics.

## Releasing ads.js

jsDelivr serves `embed/dist/ads.min.js` straight from this GitHub repository at a version tag, so the build is committed.

1. Bump `version` in `embed/package.json`.
2. `npm run release:embed`. It builds, checks the script is under 4 KB gzipped, writes `embed/dist/manifest.json`, and prints the next commands.
3. Commit `embed/dist`, tag `v<version>`, and push the tag.
4. Set `EMBED_VERSION` and `EMBED_SRI` on the ad server and redeploy. The Snippet page then shows the new pinned tag. Sites must update their script tag to move to the new version; the floating `@1` URL moves by itself but cannot use SRI.

The repository must be public for jsDelivr to read it. To publish through npm instead, publish `embed/` and change the URL to `https://cdn.jsdelivr.net/npm/<package>@<version>/dist/ads.min.js`.

## How delivery works

- **Manifest** (`GET /api/v1/manifest`): active campaigns with weight, schedule, click URL, targeting, creatives, and remaining budgets, plus the list of registered domains. It has an `ETag`; an unchanged manifest answers 304.
- **Selection**: weighted random among campaigns that are in schedule, allowed on the domain, under budget, and have a creative in the best size the slot can take. The function lives in `edge/lib/selection.js` and is re-exported from `shared/selection.js`.
- **Serve IDs** are HMAC-signed tokens carrying campaign, creative, domain, and time. An impression counts once per serve and only within 10 minutes; a click counts once per serve. Bots and `HEAD` requests are not counted.
- **Viewability**: `ads.js` reports an impression only after the ad is at least 50% visible for one continuous second, and sends all of a page's impressions in one beacon.
- **Batches** (`POST /api/v1/events/batch`): pre-aggregated by hour × campaign × creative × domain. A repeated `batchId` returns the original result and changes nothing. One bad row rejects the whole batch with a list of the bad rows; the edge keeps a rejected batch in `spool/rejected/` rather than dropping it.
- **Durability**: counters are written to the spool every minute and on `SIGTERM`/`SIGINT`. Unsent batches stay on disk and are resent in order with exponential backoff.

### Caps

The ad server sees usage once an hour, so the edge enforces caps locally. The manifest gives each instance its share of the remaining total and daily budget (remaining ÷ active instances), and the edge subtracts everything it has counted that the manifest does not include yet. Daily caps reset at 00:00 UTC.

Caps can overshoot in two bounded cases: when the number of instances changes between manifests (each instance may spend the share it was last given, so the excess is at most one share per added instance until the next one-minute refresh), and by the few ads already on screen when a budget runs out, since budgets count viewable impressions rather than serves.

## Choices made along the way

- **Access tokens are signed with Node's `crypto`** (HS256) instead of adding a JWT library; the app only signs and verifies its own tokens. `openid-client` is the one library added outside the brief's list, as the brief requires.
- **Creatives are a library.** A creative may be unassigned or attached to one campaign; duplicating a campaign copies the rows and reuses the same content-addressed file.
- **Unregistered hosts get no ads.** The manifest lists registered domains so the edge never produces stats the server would reject.
- **Deleting a campaign with unreported stats rejects that batch.** The brief requires unknown campaigns to fail the batch. Prefer ending a campaign and deleting it after the next hourly batch.
- **External creatives are served from their own URL**, not proxied. `GET /api/v1/creatives/:id/image` redirects to wherever an image lives.
- **Stats use the viewer's timezone for day buckets**; data is stored in UTC hours.
- **`bcryptjs` and `hls.js` are not installed**: there are no local passwords and no video ads.
