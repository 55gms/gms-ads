import { config } from '../config.js';
import { query } from '../db/pool.js';
import { storage } from '../storage/index.js';
import { ImageError, inspectImage, processUpload } from './images.js';
import { safeFetch } from './urlGuard.js';

export const mediaKey = (sha256, ext) => `creatives/${sha256}.${ext}`;

// Where browsers load a creative from. Uploads are served by this app from
// immutable content-addressed paths; external creatives stay on their host.
export function imageUrlFor(creative) {
  if (creative.source === 'external') return creative.external_url;
  return `${config.publicBaseUrl}/media/${creative.file_path}`;
}

async function sizeById(sizeId) {
  const { rows } = await query('SELECT id, width, height FROM ad_sizes WHERE id = $1', [sizeId]);
  if (!rows[0]) throw new ImageError('Pick an ad size', 'unknown_size');
  return rows[0];
}

export async function createFromUpload({ buffer, sizeId, resize, altText, campaignId, userId }) {
  const size = await sizeById(sizeId);
  const image = await processUpload(buffer, { width: size.width, height: size.height, resize, maxBytes: config.maxUploadBytes });
  const key = mediaKey(image.sha256, image.ext);
  // Content-addressed: an identical file is already there and never changes.
  if (!(await storage.exists(key))) await storage.put(key, image.buffer);
  const webpKey = mediaKey(image.sha256, 'webp');
  if (image.webp && !(await storage.exists(webpKey))) await storage.put(webpKey, image.webp);
  const { rows } = await query(
    `INSERT INTO creatives (campaign_id, size_id, source, file_path, sha256, has_webp, width, height, mime, bytes, alt_text, created_by)
     VALUES ($1, $2, 'upload', $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [campaignId, size.id, key, image.sha256, Boolean(image.webp), image.width, image.height, image.mime, image.buffer.length, altText, userId]
  );
  return { creative: rows[0], resized: image.resized };
}

export async function createFromExternal({ url, sizeId, altText, campaignId, userId }) {
  const size = await sizeById(sizeId);
  // Fetched once to verify the real type and dimensions; only the URL is stored.
  const { buffer } = await safeFetch(url, { allowedHosts: config.externalImageHosts, maxBytes: config.maxUploadBytes });
  const info = await inspectImage(buffer);
  if (info.width !== size.width || info.height !== size.height) {
    throw new ImageError(`Image is ${info.width}×${info.height} but the selected size is ${size.width}×${size.height}`, 'dimension_mismatch');
  }
  const { rows } = await query(
    `INSERT INTO creatives (campaign_id, size_id, source, external_url, width, height, mime, bytes, alt_text, created_by)
     VALUES ($1, $2, 'external', $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [campaignId, size.id, new URL(url).toString(), info.width, info.height, info.mime, buffer.length, altText, userId]
  );
  return { creative: rows[0] };
}

// Removes the row, then the file only when no other creative shares its hash.
export async function deleteCreative(id) {
  const { rows } = await query('DELETE FROM creatives WHERE id = $1 RETURNING *', [id]);
  const creative = rows[0];
  if (!creative) return null;
  if (creative.source === 'upload' && creative.sha256) {
    const { rows: others } = await query('SELECT 1 FROM creatives WHERE sha256 = $1 LIMIT 1', [creative.sha256]);
    if (!others.length) {
      await storage.delete(creative.file_path);
      await storage.delete(mediaKey(creative.sha256, 'webp'));
    }
  }
  return creative;
}
