CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  iss text NOT NULL,
  sub text NOT NULL,
  email text,
  name text,
  avatar text,
  role text NOT NULL DEFAULT 'viewer' CHECK (role IN ('owner', 'admin', 'viewer')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'disabled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz,
  UNIQUE (iss, sub)
);

CREATE TABLE refresh_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  family_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_family_idx ON refresh_tokens (family_id);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);
CREATE INDEX refresh_tokens_expires_idx ON refresh_tokens (expires_at);

CREATE TABLE domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hostname text NOT NULL UNIQUE,
  enabled boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX domains_hostname_pattern_idx ON domains (hostname text_pattern_ops);

CREATE TABLE ad_sizes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  width integer NOT NULL CHECK (width BETWEEN 1 AND 4000),
  height integer NOT NULL CHECK (height BETWEEN 1 AND 4000),
  name text NOT NULL,
  is_custom boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (width, height)
);

CREATE TABLE campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'active', 'paused', 'ended')),
  weight integer NOT NULL DEFAULT 50 CHECK (weight BETWEEN 1 AND 100),
  starts_at timestamptz,
  ends_at timestamptz,
  total_impression_cap bigint CHECK (total_impression_cap IS NULL OR total_impression_cap > 0),
  daily_impression_cap bigint CHECK (daily_impression_cap IS NULL OR daily_impression_cap > 0),
  click_url text NOT NULL,
  targeting_mode text NOT NULL DEFAULT 'all' CHECK (targeting_mode IN ('all', 'include', 'exclude')),
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (starts_at IS NULL OR ends_at IS NULL OR ends_at > starts_at)
);
-- Manifest builds read only active campaigns.
CREATE INDEX campaigns_active_idx ON campaigns (ends_at) WHERE status = 'active';

CREATE TABLE campaign_domains (
  campaign_id uuid NOT NULL REFERENCES campaigns (id) ON DELETE CASCADE,
  domain_id uuid NOT NULL REFERENCES domains (id) ON DELETE CASCADE,
  PRIMARY KEY (campaign_id, domain_id)
);
CREATE INDEX campaign_domains_domain_idx ON campaign_domains (domain_id);

CREATE TABLE creatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid REFERENCES campaigns (id) ON DELETE SET NULL,
  size_id uuid NOT NULL REFERENCES ad_sizes (id),
  source text NOT NULL CHECK (source IN ('upload', 'external')),
  external_url text,
  file_path text,
  sha256 text,
  has_webp boolean NOT NULL DEFAULT false,
  width integer NOT NULL,
  height integer NOT NULL,
  mime text NOT NULL,
  bytes integer NOT NULL,
  alt_text text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((source = 'upload' AND file_path IS NOT NULL AND sha256 IS NOT NULL)
      OR (source = 'external' AND external_url IS NOT NULL))
);
-- Active campaign lookup by size.
CREATE INDEX creatives_campaign_size_idx ON creatives (campaign_id, size_id) WHERE status = 'active';
CREATE INDEX creatives_size_idx ON creatives (size_id);
CREATE INDEX creatives_sha_idx ON creatives (sha256) WHERE sha256 IS NOT NULL;

CREATE TABLE site_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  prefix text NOT NULL,
  -- NULL means every registered domain; otherwise hostname patterns.
  allowed_domains text[],
  created_by uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

-- Edge instances seen recently; remaining budgets are split across them.
CREATE TABLE edge_instances (
  site_key_id uuid NOT NULL REFERENCES site_keys (id) ON DELETE CASCADE,
  instance_id text NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (site_key_id, instance_id)
);
CREATE INDEX edge_instances_seen_idx ON edge_instances (last_seen_at);

CREATE TABLE ingest_batches (
  batch_id uuid PRIMARY KEY,
  site_key_id uuid REFERENCES site_keys (id) ON DELETE SET NULL,
  period_start timestamptz,
  period_end timestamptz,
  row_count integer NOT NULL DEFAULT 0,
  impressions bigint NOT NULL DEFAULT 0,
  clicks bigint NOT NULL DEFAULT 0,
  received_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL CHECK (status IN ('accepted', 'rejected')),
  errors jsonb
);
CREATE INDEX ingest_batches_received_idx ON ingest_batches (received_at DESC);
CREATE INDEX ingest_batches_key_idx ON ingest_batches (site_key_id, received_at DESC);

CREATE TABLE stats_hourly (
  campaign_id uuid NOT NULL,
  creative_id uuid NOT NULL,
  domain text NOT NULL,
  hour timestamptz NOT NULL,
  impressions bigint NOT NULL DEFAULT 0,
  clicks bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (campaign_id, creative_id, domain, hour)
);
-- No foreign keys on purpose: stats are kept forever, even after a campaign
-- or creative is deleted.
CREATE INDEX stats_hourly_campaign_hour_idx ON stats_hourly (campaign_id, hour);
CREATE INDEX stats_hourly_domain_hour_idx ON stats_hourly (domain, hour);
CREATE INDEX stats_hourly_hour_idx ON stats_hourly (hour);

CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_created_idx ON audit_log (created_at DESC);

INSERT INTO ad_sizes (width, height, name, is_custom) VALUES
  (300, 250, 'Medium rectangle', false),
  (336, 280, 'Large rectangle', false),
  (728, 90, 'Leaderboard', false),
  (970, 90, 'Large leaderboard', false),
  (970, 250, 'Billboard', false),
  (468, 60, 'Banner', false),
  (320, 50, 'Mobile banner', false),
  (320, 100, 'Large mobile banner', false),
  (160, 600, 'Wide skyscraper', false),
  (300, 600, 'Half page', false),
  (250, 250, 'Square', false);
