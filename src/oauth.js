import fs from 'node:fs';
import path from 'node:path';
import { profileDir, DEFAULT_CLAUDE_DIR, HOME_CLAUDE_JSON } from './paths.js';
import { readJson } from './util.js';
import { listProfiles } from './registry.js';

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

// Which Anthropic account a credential source belongs to (uuid preferred).
// The default ~/.claude keeps oauthAccount in ~/.claude.json (home level);
// profiles keep it inside their own config dir.
function accountIdOf(dir) {
  const jsonPath = dir === DEFAULT_CLAUDE_DIR ? HOME_CLAUDE_JSON : path.join(dir, '.claude.json');
  const a = readJson(jsonPath, null)?.oauthAccount;
  return a?.accountUuid ?? a?.emailAddress ?? null;
}

function credentialSources() {
  return [
    ...listProfiles().map((p) => ({ label: p.name, dir: profileDir(p.name) })),
    { label: '~/.claude', dir: DEFAULT_CLAUDE_DIR },
  ];
}

// An access token that can query this profile's usage. Prefers the profile's
// own token (refreshing if needed). If that can't be revived, borrows a
// currently-valid token from any other source logged into the SAME account
// (another profile, or the ~/.claude default) — usage is per-account, so the
// number is identical. Borrowed tokens are used read-only: never refreshed or
// rotated, so a running ~/.claude session isn't disturbed.
export async function resolveToken(name) {
  const own = await validOauth(name);
  if (own.oauth) return { accessToken: own.oauth.accessToken };
  const wantId = accountIdOf(profileDir(name));
  if (wantId) {
    for (const src of credentialSources()) {
      if (src.dir === profileDir(name) || accountIdOf(src.dir) !== wantId) continue;
      const o = readJson(path.join(src.dir, '.credentials.json'), null)?.claudeAiOauth;
      if (o?.accessToken && !isExpired(o)) return { accessToken: o.accessToken, borrowedFrom: src.label };
    }
  }
  return { error: own.error };
}
