import { Router } from 'express';
import * as v from '../../../shared/validators.js';
import { query, tx } from '../../db/pool.js';
import { HttpError, asyncHandler } from '../../middleware/auth.js';
import { audit } from '../../services/audit.js';
import { imageUrlFor } from '../../services/creatives.js';
import { invalidateVideoCache } from '../../services/video/sessions.js';

const STATUSES = ['draft', 'active', 'paused', 'ended'];
const MODES = ['all', 'include', 'exclude'];
const FORMATS = ['banner', 'video_embedded', 'video_fullscreen', 'video_rewarded'];

const idParam = (req) => {
  if (!v.isUuid(req.params.id)) throw new HttpError(404, 'not_found', 'Campaign not found');
  return req.params.id;
};

function uuidList(body, field) {
  const value = body[field];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > 5000 || !value.every(v.isUuid)) v.fail(field, 'Must be a list of IDs');
  return [...new Set(value)];
}

// Reads the fields present in the body. On create every required field must
// be there; on update only the ones sent are changed.
function readCampaign(body, partial) {
  const has = (field) => !partial || body[field] !== undefined;
  const out = {};
  if (has('name')) out.name = v.str(body, 'name', { min: 1, max: 120 });
  if (has('clickUrl')) out.click_url = v.clickUrl(body, 'clickUrl');
  if (has('weight')) out.weight = v.int(body, 'weight', { min: 1, max: 100 });
  if (has('status')) out.status = v.oneOf(body, 'status', STATUSES, { required: partial }) || 'draft';
  if (has('startsAt')) out.starts_at = v.date(body, 'startsAt');
  if (has('endsAt')) out.ends_at = v.date(body, 'endsAt');
  if (has('totalImpressionCap')) out.total_impression_cap = v.int(body, 'totalImpressionCap', { min: 1, required: false });
  if (has('dailyImpressionCap')) out.daily_impression_cap = v.int(body, 'dailyImpressionCap', { min: 1, required: false });
  if (has('targetingMode')) out.targeting_mode = v.oneOf(body, 'targetingMode', MODES, { required: partial }) || 'all';
  // Video fields are optional on create so existing clients keep working.
  if (body.formats !== undefined) {
    if (!Array.isArray(body.formats) || !body.formats.length || !body.formats.every((f) => FORMATS.includes(f))) v.fail('formats', 'Pick at least one format');
    out.formats = [...new Set(body.formats)];
  }
  if (body.skipAfterSeconds !== undefined) out.skip_after_seconds = v.int(body, 'skipAfterSeconds', { min: 0, max: 60, required: false });
  if (body.rewardWatchPercent !== undefined) out.reward_watch_percent = v.int(body, 'rewardWatchPercent', { min: 50, max: 100 });
  if (body.premiumSkipSeconds !== undefined) out.premium_skip_seconds = v.int(body, 'premiumSkipSeconds', { min: 0, max: 60, required: false });
  if (out.starts_at && out.ends_at && out.ends_at <= out.starts_at) v.fail('endsAt', 'End must be after start');
  if (out.total_impression_cap && out.daily_impression_cap && out.daily_impression_cap > out.total_impression_cap) {
    v.fail('dailyImpressionCap', 'Daily cap cannot exceed the total cap');
  }
  return out;
}

async function setRelations(db, campaignId, { domainIds, creativeIds }) {
  if (domainIds) {
    await db.query('DELETE FROM campaign_domains WHERE campaign_id = $1', [campaignId]);
    if (domainIds.length) {
      await db.query(
        `INSERT INTO campaign_domains (campaign_id, domain_id)
         SELECT $1, id FROM domains WHERE id = ANY($2::uuid[])`,
        [campaignId, domainIds]
      );
    }
  }
  if (creativeIds) {
    await db.query('UPDATE creatives SET campaign_id = NULL WHERE campaign_id = $1 AND NOT (id = ANY($2::uuid[]))', [campaignId, creativeIds]);
    if (creativeIds.length) await db.query('UPDATE creatives SET campaign_id = $1 WHERE id = ANY($2::uuid[])', [campaignId, creativeIds]);
  }
}

const LIST_SQL = `
  SELECT c.*,
         coalesce(s.impressions, 0) AS impressions,
         coalesce(s.clicks, 0) AS clicks,
         coalesce(s.today, 0) AS impressions_today,
         coalesce(d.domain_ids, '{}') AS domain_ids
    FROM campaigns c
    LEFT JOIN LATERAL (
      SELECT sum(impressions) AS impressions, sum(clicks) AS clicks,
             sum(impressions) FILTER (WHERE hour >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') AS today
        FROM stats_hourly WHERE campaign_id = c.id
    ) s ON true
    LEFT JOIN LATERAL (SELECT array_agg(domain_id) AS domain_ids FROM campaign_domains WHERE campaign_id = c.id) d ON true`;

async function withCreatives(campaigns) {
  if (!campaigns.length) return campaigns;
  const { rows } = await query(
    `SELECT cr.*, s.width AS size_width, s.height AS size_height, a.status AS video_status, a.duration_seconds, a.placements
       FROM creatives cr LEFT JOIN ad_sizes s ON s.id = cr.size_id LEFT JOIN video_assets a ON a.creative_id = cr.id
      WHERE cr.campaign_id = ANY($1::uuid[]) AND cr.status = 'active' ORDER BY cr.kind, s.width DESC, s.height DESC`,
    [campaigns.map((c) => c.id)]
  );
  return campaigns.map((c) => ({
    ...c,
    creatives: rows
      .filter((cr) => cr.campaign_id === c.id)
      .map((cr) =>
        cr.kind === 'video'
          ? { id: cr.id, kind: 'video', title: cr.title, status: cr.video_status, duration_seconds: cr.duration_seconds, placements: cr.placements }
          : { id: cr.id, kind: 'image', size: `${cr.size_width}x${cr.size_height}`, size_id: cr.size_id, alt_text: cr.alt_text, source: cr.source, image_url: imageUrlFor(cr) }
      ),
  }));
}

export const campaignsRouter = Router();

campaignsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const { rows } = await query(`${LIST_SQL} ORDER BY c.created_at DESC`);
    res.json({ campaigns: await withCreatives(rows) });
  })
);

campaignsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const { rows } = await query(`${LIST_SQL} WHERE c.id = $1`, [idParam(req)]);
    if (!rows[0]) throw new HttpError(404, 'not_found', 'Campaign not found');
    res.json({ campaign: (await withCreatives(rows))[0] });
  })
);

campaignsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const fields = readCampaign(req.body, false);
    const relations = { domainIds: uuidList(req.body, 'domainIds'), creativeIds: uuidList(req.body, 'creativeIds') };
    const campaign = await tx(async (db) => {
      // Columns not sent (the video fields) keep their database defaults.
      const columns = [...Object.keys(fields), 'created_by'];
      const values = [...Object.values(fields), req.user.id];
      const { rows } = await db.query(
        `INSERT INTO campaigns (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`,
        values
      );
      await setRelations(db, rows[0].id, relations);
      return rows[0];
    });
    invalidateVideoCache();
    audit(req, 'campaign.created', 'campaign', campaign.id, { name: campaign.name, status: campaign.status });
    res.status(201).json({ campaign });
  })
);

campaignsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const fields = readCampaign(req.body, true);
    const relations = { domainIds: uuidList(req.body, 'domainIds'), creativeIds: uuidList(req.body, 'creativeIds') };
    const columns = Object.keys(fields);
    const campaign = await tx(async (db) => {
      const sets = columns.map((col, i) => `${col} = $${i + 2}`).concat('updated_at = now()');
      const { rows } = await db.query(`UPDATE campaigns SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, [id, ...columns.map((c) => fields[c])]);
      if (!rows[0]) throw new HttpError(404, 'not_found', 'Campaign not found');
      await setRelations(db, id, relations);
      return rows[0];
    });
    invalidateVideoCache();
    audit(req, 'campaign.updated', 'campaign', id, { name: campaign.name, changed: [...columns, ...Object.keys(relations).filter((k) => relations[k])] });
    res.json({ campaign });
  })
);

campaignsRouter.post(
  '/:id/duplicate',
  asyncHandler(async (req, res) => {
    const id = idParam(req);
    const copy = await tx(async (db) => {
      const { rows } = await db.query(
        `INSERT INTO campaigns (name, click_url, weight, status, starts_at, ends_at, total_impression_cap, daily_impression_cap, targeting_mode,
                                formats, skip_after_seconds, reward_watch_percent, premium_skip_seconds, created_by)
         SELECT left('Copy of ' || name, 120), click_url, weight, 'draft', starts_at, ends_at, total_impression_cap, daily_impression_cap, targeting_mode,
                formats, skip_after_seconds, reward_watch_percent, premium_skip_seconds, $2
           FROM campaigns WHERE id = $1 RETURNING *`,
        [id, req.user.id]
      );
      if (!rows[0]) throw new HttpError(404, 'not_found', 'Campaign not found');
      await db.query('INSERT INTO campaign_domains (campaign_id, domain_id) SELECT $2, domain_id FROM campaign_domains WHERE campaign_id = $1', [id, rows[0].id]);
      // Creative rows are copied; uploads keep pointing at the same content-addressed file.
      await db.query(
        `INSERT INTO creatives (campaign_id, size_id, source, external_url, file_path, sha256, has_webp, width, height, mime, bytes, alt_text, status, created_by)
         SELECT $2, size_id, source, external_url, file_path, sha256, has_webp, width, height, mime, bytes, alt_text, status, $3
           FROM creatives WHERE campaign_id = $1 AND status = 'active' AND kind = 'image'`,
        [id, rows[0].id, req.user.id]
      );
      return rows[0];
    });
    audit(req, 'campaign.duplicated', 'campaign', copy.id, { from: id, name: copy.name });
    res.status(201).json({ campaign: copy });
  })
);

campaignsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const { rows } = await query('DELETE FROM campaigns WHERE id = $1 RETURNING id, name', [idParam(req)]);
    if (!rows[0]) throw new HttpError(404, 'not_found', 'Campaign not found');
    invalidateVideoCache();
    audit(req, 'campaign.deleted', 'campaign', rows[0].id, { name: rows[0].name });
    res.json({ ok: true });
  })
);
