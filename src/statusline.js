import path from 'node:path';
import { spawn } from 'node:child_process';
import { PROFILES_DIR, SHARED_DIR } from './paths.js';
import { readJson, writeJson, colorize, dim } from './util.js';
import { getProfile, listProfiles } from './registry.js';
import { loadCache, isFresh, bestAlternative } from './usage.js';
import { ensureShared } from './shared.js';

const STALE_MS = 10 * 60_000;

// Which profile does this Claude Code session belong to? The statusline process
// inherits CLAUDE_CONFIG_DIR from the session that spawned it.
export function detectProfile(env = process.env) {
  const dir = env.CLAUDE_CONFIG_DIR;
  if (!dir) return null;
  const rel = path.relative(PROFILES_DIR, path.resolve(dir));
  if (rel.startsWith('..') || path.isAbsolute(rel) || !rel) return null;
  return rel.split(path.sep)[0];
}

export function buildLine(name, profile, usage, hint = null) {
  if (!name) return dim('○ default account (not a ccm profile)');
  const parts = [colorize(profile?.color ?? 'white', `● ${name}`)];
  if (profile?.email) parts.push(dim(profile.email));
  for (const w of usage?.windows ?? []) {
    const short = w.label.startsWith('session') ? '5h'
      : w.label === 'week (all models)' ? 'wk'
      : w.label.replace('week (', 'wk·').replace(')', '');
    const pct = Math.round(w.percent);
    const color = pct >= 90 ? 'red' : pct >= 70 ? 'yellow' : 'green';
    parts.push(colorize(color, `${short} ${pct}%`));
  }
  if (!usage?.windows?.length) parts.push(dim('usage: n/a'));
  if (hint) parts.push(colorize('yellow', hint));
  return parts.join(dim(' · '));
}

// When the session nears its limit and another account has real headroom,
// surface the escape hatch right where the user is looking.
export function limitHint(name, usage, profileNames, cache) {
  const worst = Math.max(0, ...(usage?.windows ?? []).map((w) => w.percent));
  if (worst < 90) return null;
  const alt = bestAlternative(name, profileNames, cache);
  if (!alt || alt.headroom < 30) return null;
  return `→ ccm move-session ${alt.name}`;
}

// Entry for `ccm statusline`: must be fast and never throw. Cache only;
// if the cache is stale, kick off a detached background refresh for next time.
export async function statuslineMain() {
  try {
    const name = detectProfile();
    const profile = name ? getProfile(name) : null;
    const cache = loadCache();
    const usage = name ? cache[name] : null;
    const hint = name ? limitHint(name, usage, listProfiles().map((p) => p.name), cache) : null;
    console.log(buildLine(name, profile, usage, hint));
    if (name && !isFresh(usage, STALE_MS)) {
      spawn(process.execPath, [process.argv[1], 'refresh'], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    console.log('ccm');
  }
}

export function installStatusline() {
  ensureShared();
  const file = path.join(SHARED_DIR, 'settings.json');
  const settings = readJson(file, {});
  settings.statusLine = { type: 'command', command: 'ccm statusline', padding: 0 };
  writeJson(file, settings);
  return file;
}
