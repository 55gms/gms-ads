import { Router } from 'express';
import multer from 'multer';
import * as v from '../../../shared/validators.js';
import { config } from '../../config.js';
import { query } from '../../db/pool.js';
import { HttpError, asyncHandler } from '../../middleware/auth.js';
import { uploadLimiter } from '../../middleware/rateLimit.js';
import { audit } from '../../services/audit.js';
import { createFromExternal, createFromUpload, deleteCreative, imageUrlFor } from '../../services/creatives.js';

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadBytes, files: 1, fields: 10 } });

const present = (cr) => ({
  id: cr.id,
  campaign_id: cr.campaign_id,
  campaign_name: cr.campaign_name ?? null,
  size_id: cr.size_id,
  size: `${cr.size_width}x${cr.size_height}`,
  source: cr.source,
  external_url: cr.external_url,
  width: cr.width,
  height: cr.height,
  mime: cr.mime,
  bytes: cr.bytes,
  alt_text: cr.alt_text,
  status: cr.status,
  created_at: cr.created_at,
  image_url: imageUrlFor(cr),
});

const SELECT = `
  SELECT cr.*, s.width AS size_width, s.height AS size_height, c.name AS campaign_name
    FROM creatives cr JOIN ad_sizes s ON s.id = cr.size_id LEFT JOIN campaigns c ON c.id = cr.campaign_id`;

const one = async (id) => present((await query(`${SELECT} WHERE cr.id = $1`, [id])).rows[0]);

export const creativesRouter = Router();

creativesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const { rows } = await query(`${SELECT} WHERE cr.status = 'active' ORDER BY s.width DESC, s.height DESC, cr.created_at DESC`);
    res.json({ creatives: rows.map(present) });
  })
);

creativesRouter.post(
  '/upload',
  uploadLimiter,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'upload', 'Choose an image to upload');
    const { creative, resized } = await createFromUpload({
      buffer: req.file.buffer,
      sizeId: v.uuid(req.body, 'sizeId'),
      resize: req.body.resize === 'true',
      altText: v.str(req.body, 'altText', { required: false, max: 200 }) || '',
      campaignId: v.uuid(req.body, 'campaignId', { required: false }),
      userId: req.user.id,
    });
    audit(req, 'creative.uploaded', 'creative', creative.id, { size: `${creative.width}x${creative.height}`, bytes: creative.bytes, resized });
    res.status(201).json({ creative: await one(creative.id), resized });
  })
);

creativesRouter.post(
  '/external',
  uploadLimiter,
  asyncHandler(async (req, res) => {
    const { creative } = await createFromExternal({
      url: v.str(req.body, 'url', { max: 2000 }),
      sizeId: v.uuid(req.body, 'sizeId'),
      altText: v.str(req.body, 'altText', { required: false, max: 200 }) || '',
      campaignId: v.uuid(req.body, 'campaignId', { required: false }),
      userId: req.user.id,
    });
    audit(req, 'creative.linked', 'creative', creative.id, { url: creative.external_url });
    res.status(201).json({ creative: await one(creative.id) });
  })
);

creativesRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!v.isUuid(req.params.id)) throw new HttpError(404, 'not_found', 'Creative not found');
    const sets = [];
    const params = [req.params.id];
    if (req.body.altText !== undefined) {
      params.push(v.str(req.body, 'altText', { required: false, max: 200 }) || '');
      sets.push(`alt_text = $${params.length}`);
    }
    if (req.body.campaignId !== undefined) {
      params.push(v.uuid(req.body, 'campaignId', { required: false }));
      sets.push(`campaign_id = $${params.length}`);
    }
    if (!sets.length) throw new HttpError(400, 'empty', 'Nothing to update');
    const { rows } = await query(`UPDATE creatives SET ${sets.join(', ')} WHERE id = $1 RETURNING id`, params);
    if (!rows[0]) throw new HttpError(404, 'not_found', 'Creative not found');
    audit(req, 'creative.updated', 'creative', rows[0].id);
    res.json({ creative: await one(rows[0].id) });
  })
);

creativesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    if (!v.isUuid(req.params.id)) throw new HttpError(404, 'not_found', 'Creative not found');
    const creative = await deleteCreative(req.params.id);
    if (!creative) throw new HttpError(404, 'not_found', 'Creative not found');
    audit(req, 'creative.deleted', 'creative', creative.id, { size: `${creative.width}x${creative.height}` });
    res.json({ ok: true });
  })
);
