// Structured JSON logs on stdout/stderr. Callers pass plain fields; anything
// that looks like a credential is redacted before it is written.

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const SECRET_KEY = /token|secret|password|authorization|cookie|verifier|^code$|api_?key/i;
const threshold = LEVELS[process.env.LOG_LEVEL] ?? LEVELS.info;

function redact(value, depth = 0) {
  if (value === null || typeof value !== 'object' || depth > 4) return value;
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  const out = {};
  for (const [key, v] of Object.entries(value)) out[key] = SECRET_KEY.test(key) ? '[redacted]' : redact(v, depth + 1);
  return out;
}

function write(level, msg, fields) {
  if (LEVELS[level] < threshold) return;
  const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...redact(fields) });
  (level === 'error' || level === 'warn' ? process.stderr : process.stdout).write(`${line}\n`);
}

export const logger = {
  debug: (msg, fields) => write('debug', msg, fields),
  info: (msg, fields) => write('info', msg, fields),
  warn: (msg, fields) => write('warn', msg, fields),
  error: (msg, fields) => write('error', msg, fields),
};
