import path from 'node:path';
import { profileDir, USAGE_CACHE } from './paths.js';
import { readJson, writeJson } from './util.js';

// Undocumented endpoint used by Claude Code's own /usage command. If Anthropic
// changes it, only the quota columns degrade — everything else keeps working.
const ENDPOINT = 'https://api.anthropic.com/api/oauth/usage';

export const DEFAULT_MAX_AGE_MS = 5 * 60_000;

export function readOauth(name) {
  return readJson(path.join(profileDir(name), '.credentials.json'), null)?.claudeAiOauth ?? null;
}

// Normalize the API response into [{label, percent, resetsAt, severity, active}].
export function parseWindows(data) {
  const windows = [];
  const limits = Array.isArray(data?.limits) ? data.limits.filter((l) => l?.percent != null) : [];
  if (limits.length) {
    for (const l of limits) {
      let label;
      if (l.kind === 'session') label = 'session (5h)';
      else if (l.kind === 'weekly_all') label = 'week (all models)';
      else if (l.kind === 'weekly_scoped') label = `week (${l.scope?.model?.display_name ?? 'model'})`;
      else label = String(l.kind ?? 'limit').replace(/_/g, ' ');
      windows.push({
        label,
        percent: Math.max(0, Math.min(100, l.percent)),
        resetsAt: l.resets_at ?? null,
        severity: l.severity ?? 'normal',
        active: !!l.is_active,
      });
    }
    return windows;
  }
  const legacy = {
    five_hour: 'session (5h)',
    seven_day: 'week (all models)',
    seven_day_opus: 'week (Opus)',
    seven_day_sonnet: 'week (Sonnet)',
  };
  for (const [key, val] of Object.entries(data ?? {})) {
    if (val && typeof val === 'object' && val.utilization != null) {
      windows.push({
        label: legacy[key] ?? key.replace(/_/g, ' '),
        percent: Math.max(0, Math.min(100, val.utilization)),
        resetsAt: val.resets_at ?? null,
        severity: 'normal',
        active: false,
      });
    }
  }
  return windows;
}

export async function fetchUsage(name) {
  const oauth = readOauth(name);
  if (!oauth?.accessToken) return { error: 'no-credentials' };
  if (oauth.expiresAt && oauth.expiresAt < Date.now()) return { error: 'token-expired' };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(ENDPOINT, {
      headers: { Authorization: `Bearer ${oauth.accessToken}`, 'anthropic-beta': 'oauth-2025-04-20' },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (res.status === 401 || res.status === 403) return { error: 'unauthorized' };
    if (!res.ok) return { error: `http-${res.status}` };
    return { windows: parseWindows(await res.json()), fetchedAt: Date.now() };
  } catch (e) {
    return { error: e.name === 'AbortError' ? 'timeout' : 'network' };
  }
}

export function loadCache() {
  return readJson(USAGE_CACHE, {});
}

export function saveCache(cache) {
  writeJson(USAGE_CACHE, cache);
}

export function isFresh(entry, maxAgeMs = DEFAULT_MAX_AGE_MS, now = Date.now()) {
  return !!entry?.fetchedAt && now - entry.fetchedAt < maxAgeMs;
}

// Cached usage for a profile; fetches when stale unless cacheOnly.
// On fetch failure, a stale cache entry is preferred over the error.
export async function getUsage(name, { maxAgeMs = DEFAULT_MAX_AGE_MS, cacheOnly = false } = {}) {
  const cache = loadCache();
  const hit = cache[name];
  if (cacheOnly || isFresh(hit, maxAgeMs)) return hit ?? null;
  const fresh = await fetchUsage(name);
  if (fresh.error) return hit?.windows ? hit : fresh;
  cache[name] = fresh;
  saveCache(cache);
  return fresh;
}

export async function refreshAll(names, maxAgeMs = 0) {
  await Promise.all(names.map((n) => getUsage(n, { maxAgeMs }).catch(() => null)));
}

export const ERROR_HINTS = {
  'no-credentials': 'not logged in — launch this profile and run /login',
  'token-expired': 'token expired — launch this profile once to refresh it',
  unauthorized: 'token rejected — launch this profile and run /login',
  timeout: 'usage API timed out',
  network: 'network error reaching usage API',
};
