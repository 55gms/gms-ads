import { query } from '../db/pool.js';
import { logger } from '../logger.js';

// Records who changed what. Never blocks or fails the request it describes.
export function audit(req, action, entityType, entityId, detail) {
  query('INSERT INTO audit_log (user_id, action, entity_type, entity_id, detail) VALUES ($1, $2, $3, $4, $5)', [
    req.user?.id || null,
    action,
    entityType,
    entityId ? String(entityId) : null,
    detail ? JSON.stringify(detail) : null,
  ]).catch((err) => logger.error('audit write failed', { action, error: err.message }));
}
