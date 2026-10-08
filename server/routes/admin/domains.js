import { Router } from 'express';
import * as v from '../../../shared/validators.js';
import { query } from '../../db/pool.js';
import { HttpError, asyncHandler } from '../../middleware/auth.js';
import { audit } from '../../services/audit.js';

const SORTS = { hostname: 'd.hostname', impressions: 'impressions', clicks: 'clicks', created_at: 'd.created_at' };
const MAX_IMPORT = 5000;

export const domainsRouter = Router();

// Compact list for pickers: every domain, id and hostname only.
domainsRouter.get(
  '/all',
  asyncHandler(async (_req, res) => {
    const { rows } = await query('SELECT id, hostname, enabled FROM domains ORDER BY hostname');
    res.json({ domains: rows });
  })
);

domainsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const pageSize = Math.min(200, Math.max(10, Number.parseInt(req.query.pageSize, 10) || 50));
    const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase().slice(0, 100) : '';
    const sort = SORTS[req.query.sort] || SORTS.hostname;
    const dir = req.query.dir === 'desc' ? 'DESC' : 'ASC';
    const where = [];
    const params = [];
    if (search) {
      params.push(`%${search.replace(/[\\%_]/g, '\\$&')}%`);
      where.push(`d.hostname LIKE $${params.length}`);
    }
    if (req.query.enabled === 'true' || req.query.enabled === 'false') {
      params.push(req.query.enabled === 'true');
      where.push(`d.enabled = $${params.length}`);
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const total = await query(`SELECT count(*)::int AS n FROM domains d ${clause}`, params);
    // Traffic for the last 30 days. Wildcard entries show the sum of the hosts they cover.
    const { rows } = await query(
      `SELECT d.*, coalesce(t.impressions, 0) AS impressions, coalesce(t.clicks, 0) AS clicks
         FROM domains d
         LEFT JOIN LATERAL (
           SELECT sum(impressions) AS impressions, sum(clicks) AS clicks FROM stats_hourly s
            WHERE s.hour >= now() - interval '30 days'
              AND (s.domain = d.hostname OR (d.hostname LIKE '*.%' AND s.domain LIKE '%' || substr(d.hostname, 2)))
         ) t ON true
         ${clause}
        ORDER BY ${sort} ${dir}, d.hostname ASC
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      params
    );
    res.json({ domains: rows, total: total.rows[0].n, page, pageSize });
  })
);

domainsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const hostname = v.cleanHostname(req.body.hostname);
    if (!hostname) v.fail('hostname', 'Enter a hostname like example.com or *.example.com');
    const notes = v.str(req.body, 'notes', { required: false, max: 500 });
    const { rows } = await query('INSERT INTO domains (hostname, notes) VALUES ($1, $2) RETURNING *', [hostname, notes]);
    audit(req, 'domain.added', 'domain', rows[0].id, { hostname });
    res.status(201).json({ domain: rows[0] });
  })
);

// Bulk paste: hostnames separated by whitespace, commas, or semicolons.
domainsRouter.post(
  '/import',
  asyncHandler(async (req, res) => {
    const raw = Array.isArray(req.body.hostnames) ? req.body.hostnames.join('\n') : req.body.hostnames;
    if (typeof raw !== 'string' || !raw.trim()) v.fail('hostnames', 'Paste at least one hostname');
    const tokens = raw.split(/[\s,;]+/).filter(Boolean);
    if (tokens.length > MAX_IMPORT) v.fail('hostnames', `Import at most ${MAX_IMPORT} hostnames at a time`);
    const valid = new Set();
    const invalid = [];
    for (const token of tokens) {
      const hostname = v.cleanHostname(token);
      if (hostname) valid.add(hostname);
      else if (invalid.length < 50) invalid.push(token.slice(0, 100));
    }
    let added = 0;
    if (valid.size) {
      const { rowCount } = await query(
        'INSERT INTO domains (hostname) SELECT unnest($1::text[]) ON CONFLICT (hostname) DO NOTHING',
        [[...valid]]
      );
      added = rowCount;
    }
    audit(req, 'domain.imported', 'domain', null, { added, skipped: valid.size - added, invalid: invalid.length });
    res.json({ added, skipped: valid.size - added, invalid });
  })
);

domainsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!v.isUuid(req.params.id)) throw new HttpError(404, 'not_found', 'Domain not found');
    const sets = [];
    const params = [req.params.id];
    if (req.body.enabled !== undefined) {
      params.push(v.bool(req.body, 'enabled'));
      sets.push(`enabled = $${params.length}`);
    }
    if (req.body.notes !== undefined) {
      params.push(v.str(req.body, 'notes', { required: false, max: 500 }));
      sets.push(`notes = $${params.length}`);
    }
    if (!sets.length) throw new HttpError(400, 'empty', 'Nothing to update');
    const { rows } = await query(`UPDATE domains SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, params);
    if (!rows[0]) throw new HttpError(404, 'not_found', 'Domain not found');
    audit(req, 'domain.updated', 'domain', rows[0].id, { hostname: rows[0].hostname, enabled: rows[0].enabled });
    res.json({ domain: rows[0] });
  })
);

domainsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!v.isUuid(req.params.id)) throw new HttpError(404, 'not_found', 'Domain not found');
    const { rows } = await query('DELETE FROM domains WHERE id = $1 RETURNING id, hostname', [req.params.id]);
    if (!rows[0]) throw new HttpError(404, 'not_found', 'Domain not found');
    audit(req, 'domain.removed', 'domain', rows[0].id, { hostname: rows[0].hostname });
    res.json({ ok: true });
  })
);
