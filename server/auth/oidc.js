// Authometry sign-in: Authorization Code with S256 PKCE through openid-client,
// which validates signature, issuer, audience, expiry, and nonce.

import * as oidc from 'openid-client';
import { config } from '../config.js';
import { COOKIES, clearCookie, parseCookies, seal, setCookie, unseal } from './cookies.js';

const ATTEMPT_TTL_SECONDS = 10 * 60;
export const redirectUri = () => `${config.publicBaseUrl}/auth/callback`;

let discovered = null;
export async function getOidcConfig() {
  if (!config.authometry.clientId || !config.authometry.clientSecret) {
    const err = new Error('Authometry is not configured. Set AUTHOMETRY_CLIENT_ID and AUTHOMETRY_CLIENT_SECRET.');
    err.status = 503;
    throw err;
  }
  // Cache the promise; a failed discovery is retried on the next attempt.
  discovered ||= oidc
    .discovery(
      new URL(config.authometry.issuer),
      config.authometry.clientId,
      undefined,
      oidc.ClientSecretBasic(config.authometry.clientSecret)
    )
    .catch((err) => {
      discovered = null;
      throw err;
    });
  return discovered;
}

// States already redeemed in this process. The attempt cookie is also cleared
// on first use; this closes the window where a captured cookie is replayed.
const consumed = new Map();
function consumeOnce(state) {
  const now = Date.now();
  for (const [key, expires] of consumed) if (expires < now) consumed.delete(key);
  if (consumed.has(state)) return false;
  consumed.set(state, now + ATTEMPT_TTL_SECONDS * 1000);
  return true;
}

const attemptCookie = (state) => COOKIES.attemptPrefix + state.slice(0, 16).replace(/[^A-Za-z0-9_-]/g, '');

export async function beginLogin(res, returnTo) {
  const cfg = await getOidcConfig();
  const state = oidc.randomState();
  const nonce = oidc.randomNonce();
  const verifier = oidc.randomPKCECodeVerifier();
  const challenge = await oidc.calculatePKCECodeChallenge(verifier);
  // One cookie per attempt, so concurrent tabs do not clobber each other.
  setCookie(res, attemptCookie(state), seal({ state, nonce, verifier, returnTo, exp: Date.now() + ATTEMPT_TTL_SECONDS * 1000 }), {
    maxAgeSeconds: ATTEMPT_TTL_SECONDS,
    path: '/auth',
  });
  return oidc.buildAuthorizationUrl(cfg, {
    redirect_uri: redirectUri(),
    scope: 'openid profile email',
    response_type: 'code',
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
}

function authError(message) {
  const err = new Error(message);
  err.status = 400;
  err.expose = true;
  return err;
}

export async function completeLogin(req, res) {
  const state = typeof req.query.state === 'string' ? req.query.state : '';
  if (!state) throw authError('Sign-in response is missing its state');
  const name = attemptCookie(state);
  const attempt = unseal(parseCookies(req.headers.cookie)[name] || '');
  clearCookie(res, name, { path: '/auth' });
  if (!attempt || attempt.state !== state || attempt.exp < Date.now()) throw authError('Sign-in attempt expired or does not match. Try again.');
  if (!consumeOnce(state)) throw authError('This sign-in response was already used');
  if (typeof req.query.error === 'string') throw authError('Sign-in was cancelled or denied');

  const cfg = await getOidcConfig();
  // Rebuild the callback URL on the public origin so it matches the registered redirect URI.
  const currentUrl = new URL(req.originalUrl, config.publicBaseUrl);
  let tokens;
  try {
    tokens = await oidc.authorizationCodeGrant(cfg, currentUrl, {
      pkceCodeVerifier: attempt.verifier,
      expectedState: attempt.state,
      expectedNonce: attempt.nonce,
      idTokenExpected: true,
    });
  } catch {
    throw authError('Sign-in could not be verified. Try again.');
  }
  const claims = tokens.claims();
  if (!claims?.sub || !claims.iss) throw authError('Sign-in response is missing an identity');
  return { claims, returnTo: attempt.returnTo };
}

export async function endSessionUrl() {
  if (!config.authometry.providerLogout) return null;
  try {
    const cfg = await getOidcConfig();
    if (!cfg.serverMetadata().end_session_endpoint) return null;
    return oidc.buildEndSessionUrl(cfg, { post_logout_redirect_uri: `${config.publicBaseUrl}/` }).href;
  } catch {
    return null;
  }
}
