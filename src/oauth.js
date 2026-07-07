import fs from 'node:fs';
import path from 'node:path';
import { profileDir } from './paths.js';
import { readJson } from './util.js';

// Claude Code's OAuth client — CLIENT_ID confirmed from the CLI binary
// (CLIENT_ID:"9d1c250a…"). The token endpoint is api.anthropic.com, verified
// by probing: it returns invalid_grant for a bad token (right endpoint) where
// claude.com/v1/oauth/token is a plain 405. ccm refreshes a profile's access
// token the same way Claude Code does, so the dashboard is accurate even for
// accounts that aren't currently running.
const TOKEN_URL = 'https://api.anthropic.com/v1/oauth/token';
const CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e';
const REFRESH_SKEW_MS = 60_000; // refresh a token about to expire, not just an expired one

function credsPath(name) {
  return path.join(profileDir(name), '.credentials.json');
}

export function readOauth(name) {
  return readJson(credsPath(name), null)?.claudeAiOauth ?? null;
}

export function isExpired(oauth, now = Date.now()) {
  return !oauth?.expiresAt || oauth.expiresAt <= now + REFRESH_SKEW_MS;
}

// Persist rotated credentials without disturbing the rest of the file
// (mcpOAuth etc.). Write-then-rename so a crash can't leave a half-written
// credentials file that would log the account out.
function persist(name, oauth) {
  const file = credsPath(name);
  const full = readJson(file, {}) ?? {};
  full.claudeAiOauth = oauth;
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(full, null, 2));
  fs.renameSync(tmp, file);
}

// Exchange the refresh token for a fresh access token. Anthropic rotates
// refresh tokens, so the new one is persisted immediately. Returns the new
// oauth object, or { error } on failure (caller falls back gracefully).
export async function refreshToken(name) {
  const oauth = readOauth(name);
  if (!oauth?.refreshToken) return { error: 'no-refresh-token' };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant_type: 'refresh_token', refresh_token: oauth.refreshToken, client_id: CLIENT_ID }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return { error: res.status === 400 || res.status === 401 ? 'refresh-rejected' : `refresh-http-${res.status}` };
    const data = await res.json();
    if (!data.access_token) return { error: 'refresh-malformed' };
    const next = {
      ...oauth,
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? oauth.refreshToken,
      expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
      scopes: data.scope ? data.scope.split(' ') : oauth.scopes,
    };
    persist(name, next);
    return next;
  } catch (e) {
    return { error: e.name === 'AbortError' ? 'refresh-timeout' : 'refresh-network' };
  }
}

// A non-expired oauth for the profile, refreshing if needed.
// Returns { oauth } or { error }.
export async function validOauth(name) {
  const oauth = readOauth(name);
  if (!oauth?.accessToken) return { error: 'no-credentials' };
  if (!isExpired(oauth)) return { oauth };
  if (!oauth.refreshToken) return { error: 'token-expired' };
  const refreshed = await refreshToken(name);
  return refreshed.error ? { error: refreshed.error } : { oauth: refreshed };
}
