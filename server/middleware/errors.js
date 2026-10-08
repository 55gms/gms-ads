import { config } from '../config.js';
import { logger } from '../logger.js';

export function notFound(_req, res) {
  res.status(404).json({ error: 'not_found', message: 'Not found' });
}

// Central handler. Client errors pass their message through; anything
// unexpected is logged with its stack and answered with a generic message.
 
export function errorHandler(err, req, res, _next) {
  let status = err.status || err.statusCode || 500;
  let code = err.code && typeof err.code === 'string' ? err.code : undefined;
  let message = err.message;

  if (err.name === 'MulterError') {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    message = err.code === 'LIMIT_FILE_SIZE' ? 'File is larger than 2 MB' : 'Upload could not be read';
    code = 'upload';
  } else if (err.type === 'entity.too.large') {
    status = 413;
    message = 'Request body is too large';
  } else if (err.type === 'entity.parse.failed' || err.type === 'encoding.unsupported') {
    status = 400;
    message = 'Request body is not valid JSON';
  } else if (err.code === '23505') {
    status = 409;
    code = 'conflict';
    message = 'That already exists';
  } else if (err.code === '23503') {
    status = 409;
    code = 'in_use';
    message = 'That is still in use and cannot be removed';
  }

  if (status >= 500) {
    logger.error('request failed', { method: req.method, path: req.path, status, error: err.message, stack: err.stack });
    if (config.isProd) message = 'Something went wrong';
    code = 'server_error';
  }
  if (res.headersSent) return;
  res.status(status).json({ error: code || 'error', message, ...(err.fields ? { fields: err.fields } : {}), ...(err.details ? { details: err.details } : {}) });
}
