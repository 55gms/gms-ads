// Small request validators shared across the server. Each returns the cleaned
// value or throws a ValidationError naming the field.

export class ValidationError extends Error {
  constructor(message, fields) {
    super(message);
    this.name = 'ValidationError';
    this.status = 400;
    this.fields = fields;
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HOST_LABEL = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const HOSTNAME_RE = new RegExp(`^(?:\\*\\.)?(?:${HOST_LABEL}\\.)+[a-z]{2,63}$`);

export const isUuid = (v) => typeof v === 'string' && UUID_RE.test(v);

export function isHostnamePattern(v) {
  return typeof v === 'string' && v.length <= 253 && HOSTNAME_RE.test(v);
}

// Accepts pasted input such as "https://Example.com/path" and returns "example.com".
export function cleanHostname(raw) {
  if (typeof raw !== 'string') return null;
  let h = raw.trim().toLowerCase();
  if (!h) return null;
  h = h.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  h = h.split(/[/?#]/)[0];
  h = h.replace(/:\d+$/, '').replace(/\.$/, '');
  return isHostnamePattern(h) ? h : null;
}

export function fail(field, message) {
  throw new ValidationError(message, { [field]: message });
}

export function str(body, field, { min = 0, max = 500, required = true, trim = true } = {}) {
  let v = body[field];
  if (v === undefined || v === null || v === '') {
    if (required) fail(field, 'This field is required');
    return null;
  }
  if (typeof v !== 'string') fail(field, 'Must be text');
  if (trim) v = v.trim();
  if (v.length < min) fail(field, min === 1 ? 'This field is required' : `Must be at least ${min} characters`);
  if (v.length > max) fail(field, `Must be at most ${max} characters`);
  return v;
}

export function int(body, field, { min = 0, max = Number.MAX_SAFE_INTEGER, required = true } = {}) {
  const v = body[field];
  if (v === undefined || v === null || v === '') {
    if (required) fail(field, 'This field is required');
    return null;
  }
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isInteger(n)) fail(field, 'Must be a whole number');
  if (n < min) fail(field, `Must be at least ${min}`);
  if (n > max) fail(field, `Must be at most ${max}`);
  return n;
}

export function oneOf(body, field, allowed, { required = true } = {}) {
  const v = body[field];
  if (v === undefined || v === null || v === '') {
    if (required) fail(field, 'This field is required');
    return null;
  }
  if (!allowed.includes(v)) fail(field, `Must be one of ${allowed.join(', ')}`);
  return v;
}

export function bool(body, field, { required = true } = {}) {
  const v = body[field];
  if (v === undefined || v === null) {
    if (required) fail(field, 'This field is required');
    return null;
  }
  if (typeof v !== 'boolean') fail(field, 'Must be true or false');
  return v;
}

export function date(body, field, { required = false } = {}) {
  const v = body[field];
  if (v === undefined || v === null || v === '') {
    if (required) fail(field, 'This field is required');
    return null;
  }
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  if (Number.isNaN(t)) fail(field, 'Must be a valid date');
  return new Date(t);
}

export function uuid(body, field, { required = true } = {}) {
  const v = body[field];
  if (v === undefined || v === null || v === '') {
    if (required) fail(field, 'This field is required');
    return null;
  }
  if (!isUuid(v)) fail(field, 'Must be a valid ID');
  return v;
}

// Public https URL for click destinations. Structure only; no network access.
export function httpsUrl(body, field, { required = true, allowHttp = false } = {}) {
  const v = str(body, field, { required, max: 2000 });
  if (v === null) return null;
  let u;
  try {
    u = new URL(v);
  } catch {
    fail(field, 'Must be a valid URL');
  }
  if (u.protocol !== 'https:' && !(allowHttp && u.protocol === 'http:')) fail(field, 'Must start with https://');
  if (u.username || u.password) fail(field, 'Must not contain credentials');
  return u.toString();
}

const UNSAFE_PATH_CHARS = /[\\\u0000-\u001f\u007f]/; // eslint-disable-line no-control-regex

// A post-login return path is accepted only when it is a plain local path:
// one leading slash, nothing absolute, protocol-relative, backslashed, or
// encoded in a way that could escape the origin.
export function safeReturnPath(raw, fallback = '/') {
  if (typeof raw !== 'string' || raw.length === 0 || raw.length > 512) return fallback;
  if (raw[0] !== '/' || raw[1] === '/' || raw[1] === '\\') return fallback;
  if (UNSAFE_PATH_CHARS.test(raw)) return fallback;
  let decoded = raw;
  try {
    for (let i = 0; i < 3; i++) {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    }
  } catch {
    return fallback;
  }
  if (decoded.startsWith('//') || UNSAFE_PATH_CHARS.test(decoded) || decoded.includes('://')) return fallback;
  if (raw.startsWith('/auth/')) return fallback;
  try {
    const u = new URL(raw, 'http://local.invalid');
    if (u.origin !== 'http://local.invalid') return fallback;
    return u.pathname + u.search + u.hash;
  } catch {
    return fallback;
  }
}
