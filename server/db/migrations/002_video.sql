-- Video ads, rewarded sessions, external providers, and video analytics.
-- Additive only: every existing image campaign, creative, and stats row keeps
-- working without a data migration.

-- --- Campaign formats -------------------------------------------------------
-- 'banner' is the existing image slot. Existing campaigns become banner-only,
-- which is exactly what they served before.
ALTER TABLE campaigns
  ADD COLUMN formats text[] NOT NULL DEFAULT '{banner}',
  -- First-party skip policy for non-rewarded video; NULL means never skippable.
  ADD COLUMN skip_after_seconds integer DEFAULT 5 CHECK (skip_after_seconds IS NULL OR skip_after_seconds BETWEEN 0 AND 60),
  -- Share of the video a free viewer must watch for a rewarded grant.
  ADD COLUMN reward_watch_percent integer NOT NULL DEFAULT 100 CHECK (reward_watch_percent BETWEEN 50 AND 100),
  -- Premium viewers may skip rewarded first-party ads after this many seconds and still be rewarded.
  ADD COLUMN premium_skip_seconds integer DEFAULT 5 CHECK (premium_skip_seconds IS NULL OR premium_skip_seconds BETWEEN 0 AND 60),
  ADD CONSTRAINT campaigns_formats_check CHECK (formats <@ ARRAY['banner', 'video_embedded', 'video_fullscreen', 'video_rewarded']::text[] AND cardinality(formats) > 0);

-- --- Video creatives --------------------------------------------------------
-- A video creative is a creatives row (kind = 'video') plus one video_assets
-- row holding provider state. Image creatives are untouched.
ALTER TABLE creatives
  ADD COLUMN kind text NOT NULL DEFAULT 'image' CHECK (kind IN ('image', 'video')),
  ADD COLUMN title text NOT NULL DEFAULT '',
  ALTER COLUMN size_id DROP NOT NULL;

ALTER TABLE creatives DROP CONSTRAINT IF EXISTS creatives_source_check;
ALTER TABLE creatives DROP CONSTRAINT IF EXISTS creatives_check;
ALTER TABLE creatives
  ADD CONSTRAINT creatives_source_check CHECK (source IN ('upload', 'external', 'stream')),
  ADD CONSTRAINT creatives_check CHECK (
    (kind = 'image' AND size_id IS NOT NULL AND (
      (source = 'upload' AND file_path IS NOT NULL AND sha256 IS NOT NULL)
      OR (source = 'external' AND external_url IS NOT NULL)))
    OR (kind = 'video' AND source IN ('stream', 'external'))
  );
CREATE INDEX creatives_kind_idx ON creatives (kind, campaign_id) WHERE status = 'active';

CREATE TABLE video_assets (
  creative_id uuid PRIMARY KEY REFERENCES creatives (id) ON DELETE CASCADE,
  -- 'bunny' for Bunny Stream; 'external' for a progressive file hosted elsewhere.
  provider text NOT NULL CHECK (provider IN ('bunny', 'external')),
  provider_video_id text,
  external_url text,
  status text NOT NULL DEFAULT 'uploading' CHECK (status IN ('uploading', 'uploaded', 'processing', 'ready', 'failed', 'archived')),
  encode_progress integer NOT NULL DEFAULT 0,
  duration_seconds numeric(8, 2),
  width integer,
  height integer,
  available_resolutions text,
  has_mp4_fallback boolean NOT NULL DEFAULT false,
  thumbnail_file text,
  poster_url text,
  -- Which video formats this creative may serve in.
  placements text[] NOT NULL DEFAULT '{video_embedded,video_fullscreen,video_rewarded}',
  error text,
  upload_expires_at timestamptz,
  last_synced_at timestamptz,
  sync_attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((provider = 'bunny' AND provider_video_id IS NOT NULL) OR (provider = 'external' AND external_url IS NOT NULL)),
  CHECK (placements <@ ARRAY['video_embedded', 'video_fullscreen', 'video_rewarded']::text[])
);
CREATE UNIQUE INDEX video_assets_provider_idx ON video_assets (provider, provider_video_id) WHERE provider_video_id IS NOT NULL;
-- The poller looks only at assets that are still moving.
CREATE INDEX video_assets_pending_idx ON video_assets (updated_at) WHERE status IN ('uploading', 'uploaded', 'processing');

-- --- External providers -----------------------------------------------------
-- Public configuration only. Secrets (if a provider ever needs one) come from
-- the environment and never from this table.
CREATE TABLE ad_providers (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9_]{2,40}$'),
  type text NOT NULL CHECK (type IN ('first_party', 'google_h5', 'vast')),
  name text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  formats text[] NOT NULL DEFAULT '{}',
  priority integer NOT NULL DEFAULT 100,
  config jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'unconfigured' CHECK (status IN ('ok', 'unconfigured', 'error')),
  status_message text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (formats <@ ARRAY['video_embedded', 'video_fullscreen', 'video_rewarded']::text[])
);

INSERT INTO ad_providers (id, type, name, enabled, formats, priority, status) VALUES
  ('first_party', 'first_party', '55GMS campaigns', true, '{video_embedded,video_fullscreen,video_rewarded}', 10, 'ok'),
  ('google_h5', 'google_h5', 'Google H5 Games Ads', false, '{video_fullscreen,video_rewarded}', 50, 'unconfigured'),
  ('vast', 'vast', 'VAST tag', false, '{video_embedded,video_fullscreen}', 60, 'unconfigured');

-- --- Playback sessions ------------------------------------------------------
-- One row per video ad request that filled (first party) or per provider ad
-- shown. Short-lived; rewarded grants are decided from this row.
CREATE TABLE ad_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  provider text NOT NULL,
  format text NOT NULL CHECK (format IN ('video_embedded', 'video_fullscreen', 'video_rewarded')),
  campaign_id uuid,
  creative_id uuid,
  site_key_id uuid REFERENCES site_keys (id) ON DELETE SET NULL,
  domain text NOT NULL,
  game_id text,
  placement text,
  reward_id text,
  -- Pseudonymous: an HMAC of a signed-in user ID or of IP + user agent + day.
  viewer_key text NOT NULL,
  premium boolean NOT NULL DEFAULT false,
  state text NOT NULL DEFAULT 'created' CHECK (state IN ('created', 'started', 'completed', 'skipped', 'closed', 'error', 'expired')),
  duration_seconds numeric(8, 2),
  required_seconds numeric(8, 2),
  skip_after_seconds numeric(8, 2),
  -- Furthest playback position the client reported, and milestones reached.
  position_seconds numeric(8, 2) NOT NULL DEFAULT 0,
  milestones text[] NOT NULL DEFAULT '{}',
  reward_eligible boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  ended_at timestamptz,
  expires_at timestamptz NOT NULL
);
CREATE INDEX ad_sessions_viewer_idx ON ad_sessions (viewer_key, created_at DESC);
CREATE INDEX ad_sessions_expires_idx ON ad_sessions (expires_at);

-- --- Reward grants ----------------------------------------------------------
-- At most one per session, enforced by the unique key, so replays and
-- concurrent claims cannot mint a second grant.
CREATE TABLE reward_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL UNIQUE REFERENCES ad_sessions (id) ON DELETE CASCADE,
  game_id text,
  viewer_key text NOT NULL,
  reward_id text,
  -- completion: watched the required share. premium_skip: verified Premium
  -- viewer skipped after the allowed time. provider_reported: an external
  -- provider's client-side completion event (not server-verifiable).
  method text NOT NULL CHECK (method IN ('completion', 'premium_skip', 'provider_reported')),
  state text NOT NULL DEFAULT 'issued' CHECK (state IN ('issued', 'redeemed', 'revoked')),
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  redeemed_at timestamptz
);
CREATE INDEX reward_grants_viewer_idx ON reward_grants (viewer_key, created_at DESC);

-- --- Video analytics --------------------------------------------------------
-- Counted in real time from the session endpoints. Kept separate from
-- stats_hourly, whose image semantics (viewable impressions, clicks) do not
-- change. Provider-reported numbers live in their own provider rows and are
-- never merged into first-party campaign rows.
CREATE TABLE video_stats_hourly (
  hour timestamptz NOT NULL,
  provider text NOT NULL,
  format text NOT NULL,
  campaign_id uuid,
  creative_id uuid,
  game_id text NOT NULL DEFAULT '',
  domain text NOT NULL DEFAULT '',
  requests bigint NOT NULL DEFAULT 0,
  fills bigint NOT NULL DEFAULT 0,
  -- Poster at least half visible for a second (embedded) or modal opened.
  impressions bigint NOT NULL DEFAULT 0,
  starts bigint NOT NULL DEFAULT 0,
  q1 bigint NOT NULL DEFAULT 0,
  midpoints bigint NOT NULL DEFAULT 0,
  q3 bigint NOT NULL DEFAULT 0,
  completes bigint NOT NULL DEFAULT 0,
  skips bigint NOT NULL DEFAULT 0,
  errors bigint NOT NULL DEFAULT 0,
  clicks bigint NOT NULL DEFAULT 0,
  rewards bigint NOT NULL DEFAULT 0
);
-- campaign_id/creative_id are NULL for no-fill and provider rows, so the
-- natural key uses coalesced values.
CREATE UNIQUE INDEX video_stats_hourly_key ON video_stats_hourly (
  hour, provider, format,
  coalesce(campaign_id, '00000000-0000-0000-0000-000000000000'::uuid),
  coalesce(creative_id, '00000000-0000-0000-0000-000000000000'::uuid),
  game_id, domain
);
CREATE INDEX video_stats_hourly_campaign_idx ON video_stats_hourly (campaign_id, hour);
CREATE INDEX video_stats_hourly_hour_idx ON video_stats_hourly (hour);
