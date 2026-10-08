import { Router } from 'express';
import * as v from '../../../shared/validators.js';
import { revokeUserSessions } from '../../auth/session.js';
import { query, tx } from '../../db/pool.js';
import { HttpError, asyncHandler, requireRole } from '../../middleware/auth.js';
import { generateSiteKey } from '../../middleware/siteKey.js';
import { audit } from '../../services/audit.js';

export const settingsRouter = Router();

// --- Members ---------------------------------------------------------------

settingsRouter.get(
  '/users',
  asyncHandler(async (_req, res) => {
    const { rows } = await query(
      `SELECT id, email, name, avatar, role, status, created_at, last_login_at FROM users
        ORDER BY (status = 'pending') DESC, created_at ASC`
    );
    res.json({ users: rows });
  })
);

settingsRouter.patch(
  '/users/:id',
  requireRole('owner', 'admin'),
  asyncHandler(async (req, res) => {
    if (!v.isUuid(req.params.id)) throw new HttpError(404, 'not_found', 'Member not found');
    const role = v.oneOf(req.body, 'role', ['owner', 'admin', 'viewer'], { required: false });
    const status = v.oneOf(req.body, 'status', ['active', 'disabled'], { required: false });
    if (!role && !status) throw new HttpError(400, 'empty', 'Nothing to update');
    if (req.params.id === req.user.id) throw new HttpError(400, 'self', 'You cannot change your own access');

    const updated = await tx(async (db) => {
      const { rows } = await db.query('SELECT id, email, role, status FROM users WHERE id = $1 FOR UPDATE', [req.params.id]);
      const target = rows[0];
      if (!target) throw new HttpError(404, 'not_found', 'Member not found');
      // Only owners manage owners or hand out the owner role.
      if ((target.role === 'owner' || role === 'owner') && req.user.role !== 'owner') {
        throw new HttpError(403, 'forbidden', 'Only an owner can change owner access');
      }
      const next = await db.query('UPDATE users SET role = coalesce($2, role), status = coalesce($3, status) WHERE id = $1 RETURNING id, email, role, status', [
        target.id,
        role,
        status,
      ]);
      const owners = await db.query("SELECT count(*)::int AS n FROM users WHERE role = 'owner' AND status = 'active'");
      if (owners.rows[0].n === 0) throw new HttpError(400, 'last_owner', 'There must be at least one active owner');
      return { before: target, after: next.rows[0] };
    });
    if (updated.after.status === 'disabled') await revokeUserSessions(updated.after.id);
    audit(req, 'user.updated', 'user', updated.after.id, {
      email: updated.after.email,
      role: [updated.before.role, updated.after.role],
      status: [updated.before.status, updated.after.status],
    });
    res.json({ user: updated.after });
  })
);

// --- Ad sizes --------------------------------------------------------------

settingsRouter.get(
  '/sizes',
  asyncHandler(async (_req, res) => {
    const { rows } = await query(
      `SELECT s.*, (SELECT count(*)::int FROM creatives c WHERE c.size_id = s.id) AS creative_count
         FROM ad_sizes s ORDER BY s.is_custom, s.width DESC, s.height DESC`
    );
    res.json({ sizes: rows });
  })
);

settingsRouter.post(
  '/sizes',
  asyncHandler(async (req, res) => {
    const width = v.int(req.body, 'width', { min: 1, max: 4000 });
    const height = v.int(req.body, 'height', { min: 1, max: 4000 });
    const name = v.str(req.body, 'name', { required: false, max: 60 }) || 'Custom';
    const { rows } = await query('INSERT INTO ad_sizes (width, height, name, is_custom) VALUES ($1, $2, $3, true) RETURNING *', [width, height, name]);
    audit(req, 'size.added', 'ad_size', rows[0].id, { size: `${width}x${height}` });
    res.status(201).json({ size: rows[0] });
  })
);

settingsRouter.delete(
  '/sizes/:id',
  asyncHandler(async (req, res) => {
    if (!v.isUuid(req.params.id)) throw new HttpError(404, 'not_found', 'Size not found');
    const { rows } = await query('DELETE FROM ad_sizes WHERE id = $1 AND is_custom RETURNING id, width, height', [req.params.id]);
    if (!rows[0]) throw new HttpError(400, 'builtin', 'Standard sizes cannot be removed');
    audit(req, 'size.removed', 'ad_size', rows[0].id, { size: `${rows[0].width}x${rows[0].height}` });
    res.json({ ok: true });
  })
);

// --- API keys --------------------------------------------------------------

settingsRouter.get(
  '/keys',
  asyncHandler(async (_req, res) => {
    const { rows } = await query(
      `SELECT k.id, k.name, k.prefix, k.allowed_domains, k.created_at, k.last_used_at, k.revoked_at, u.name AS created_by_name,
              (SELECT max(received_at) FROM ingest_batches b WHERE b.site_key_id = k.id AND b.status = 'accepted') AS last_batch_at,
              (SELECT count(*)::int FROM edge_instances e WHERE e.site_key_id = k.id AND e.last_seen_at > now() - interval '5 minutes') AS instances
         FROM site_keys k LEFT JOIN users u ON u.id = k.created_by
        ORDER BY (k.revoked_at IS NOT NULL), k.created_at DESC`
    );
    res.json({ keys: rows });
  })
);

settingsRouter.post(
  '/keys',
  asyncHandler(async (req, res) => {
    const name = v.str(req.body, 'name', { min: 1, max: 80 });
    let allowed = null;
    if (Array.isArray(req.body.allowedDomains) && req.body.allowedDomains.length) {
      allowed = req.body.allowedDomains.map(v.cleanHostname);
      if (allowed.includes(null) || allowed.length > 2000) v.fail('allowedDomains', 'Enter hostnames like example.com or *.example.com');
    }
    const { key, hash, prefix } = generateSiteKey();
    const { rows } = await query(
      'INSERT INTO site_keys (name, key_hash, prefix, allowed_domains, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id, name, prefix, created_at',
      [name, hash, prefix, allowed, req.user.id]
    );
    audit(req, 'key.created', 'site_key', rows[0].id, { name, prefix });
    // The only time the full key is ever returned.
    res.status(201).json({ key: rows[0], secret: key });
  })
);

settingsRouter.post(
  '/keys/:id/revoke',
  asyncHandler(async (req, res) => {
    if (!v.isUuid(req.params.id)) throw new HttpError(404, 'not_found', 'Key not found');
    const { rows } = await query('UPDATE site_keys SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING id, name, prefix', [req.params.id]);
    if (!rows[0]) throw new HttpError(404, 'not_found', 'Key not found or already revoked');
    audit(req, 'key.revoked', 'site_key', rows[0].id, { name: rows[0].name, prefix: rows[0].prefix });
    res.json({ ok: true });
  })
);

// --- Ingestion and audit ---------------------------------------------------

settingsRouter.get(
  '/ingest',
  asyncHandler(async (_req, res) => {
    const { rows } = await query(
      `SELECT b.*, k.name AS key_name FROM ingest_batches b LEFT JOIN site_keys k ON k.id = b.site_key_id
        ORDER BY b.received_at DESC LIMIT 200`
    );
    res.json({ batches: rows });
  })
);

settingsRouter.get(
  '/audit',
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const pageSize = 50;
    const [count, list] = await Promise.all([
      query('SELECT count(*)::int AS n FROM audit_log'),
      query(
        `SELECT a.*, u.name AS user_name, u.email AS user_email FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
          ORDER BY a.created_at DESC, a.id DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`
      ),
    ]);
    res.json({ entries: list.rows, total: count.rows[0].n, page, pageSize });
  })
);
