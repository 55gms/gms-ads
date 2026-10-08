// SSRF guard for external creative URLs: https only, no credentials, optional
// host allowlist, and every resolved address must be public. The request then
// connects to the vetted address, so a second DNS answer cannot redirect it.

import dns from 'node:dns/promises';
import https from 'node:https';
import ipaddr from 'ipaddr.js';

export class UrlGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = 'UrlGuardError';
    this.status = 400;
    this.expose = true;
  }
}

export function isPublicAddress(address) {
  let addr;
  try {
    addr = ipaddr.parse(address);
  } catch {
    return false;
  }
  if (addr.kind() === 'ipv6') {
    if (addr.isIPv4MappedAddress()) addr = addr.toIPv4Address();
    else {
      // NAT64 and 6to4 embed an IPv4 address that must be public too.
      const range = addr.range();
      if (range !== 'unicast') return false;
      return true;
    }
  }
  return addr.range() === 'unicast';
}

export function checkUrlShape(raw, { allowedHosts = [] } = {}) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new UrlGuardError('Enter a valid URL');
  }
  if (url.protocol !== 'https:') throw new UrlGuardError('URL must start with https://');
  if (url.username || url.password) throw new UrlGuardError('URL must not contain credentials');
  if (url.port && url.port !== '443') throw new UrlGuardError('URL must use the default https port');
  const host = url.hostname.toLowerCase();
  if (allowedHosts.length && !allowedHosts.includes(host)) {
    throw new UrlGuardError(`Host is not allowed. Use one of: ${allowedHosts.join(', ')}`);
  }
  return url;
}

// Resolves the host and returns one vetted address. Fails if any answer,
// IPv4 or IPv6, is private, loopback, link-local, or otherwise reserved.
export async function resolvePublic(hostname, lookup = dns.lookup) {
  const bare = hostname.replace(/^\[|\]$/g, '');
  let answers;
  try {
    answers = await lookup(bare, { all: true, verbatim: true });
  } catch {
    throw new UrlGuardError('Host could not be resolved');
  }
  if (!answers.length) throw new UrlGuardError('Host could not be resolved');
  for (const answer of answers) {
    if (!isPublicAddress(answer.address)) throw new UrlGuardError('URL resolves to a private or reserved address');
  }
  return answers[0];
}

function requestOnce(url, target, { timeoutMs, maxBytes }) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      url,
      {
        method: 'GET',
        headers: { accept: 'image/*', 'user-agent': '55gms-ads/1.0 (+creative check)' },
        timeout: timeoutMs,
        // Pin the connection to the address that passed validation.
        lookup: (_host, options, cb) =>
          options?.all ? cb(null, [{ address: target.address, family: target.family }]) : cb(null, target.address, target.family),
      },
      (res) => {
        const status = res.statusCode || 0;
        if (status >= 300 && status < 400 && res.headers.location) {
          res.resume();
          return resolve({ redirect: res.headers.location });
        }
        if (status !== 200) {
          res.resume();
          return reject(new UrlGuardError(`URL responded with status ${status}`));
        }
        if (Number(res.headers['content-length']) > maxBytes) {
          res.destroy();
          return reject(new UrlGuardError('Image is larger than 2 MB'));
        }
        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            res.destroy();
            reject(new UrlGuardError('Image is larger than 2 MB'));
          } else chunks.push(chunk);
        });
        res.on('end', () => resolve({ buffer: Buffer.concat(chunks) }));
        res.on('error', () => reject(new UrlGuardError('Download was interrupted')));
      }
    );
    req.on('timeout', () => req.destroy(new UrlGuardError('URL took too long to respond')));
    req.on('error', (err) => reject(err instanceof UrlGuardError ? err : new UrlGuardError('URL could not be fetched')));
    req.end();
  });
}

// Fetches a public https URL, following at most `maxRedirects` redirects and
// re-validating every hop.
export async function safeFetch(raw, { allowedHosts = [], maxRedirects = 3, timeoutMs = 8000, maxBytes = 2 * 1024 * 1024, lookup } = {}) {
  let current = raw;
  const deadline = Date.now() + timeoutMs * 2;
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const url = checkUrlShape(current, { allowedHosts });
    const target = await resolvePublic(url.hostname, lookup);
    const left = deadline - Date.now();
    if (left <= 0) throw new UrlGuardError('URL took too long to respond');
    const result = await requestOnce(url, target, { timeoutMs: Math.min(timeoutMs, left), maxBytes });
    if (result.buffer) return { buffer: result.buffer, finalUrl: url.toString() };
    current = new URL(result.redirect, url).toString();
  }
  throw new UrlGuardError('URL redirects too many times');
}
