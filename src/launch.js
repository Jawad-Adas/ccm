import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { profileDir } from './paths.js';
import { readJson, writeJson, colorize } from './util.js';
import { getProfile, updateProfile, refreshIdentity } from './registry.js';
import { ensureShared, linkIntoProfile, syncFilesIntoProfile } from './shared.js';

function lockPath(name) {
  return path.join(profileDir(name), 'ccm.lock');
}

export function isRunning(name) {
  const lock = readJson(lockPath(name), null);
  if (!lock?.pid) return false;
  try {
    process.kill(lock.pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Launch Claude Code bound to a profile. Blocks until the session exits.
export function launchProfile(name, args = []) {
  if (!getProfile(name)) throw new Error(`unknown profile "${name}" — run: ccm list`);
  const dir = profileDir(name);
  fs.mkdirSync(dir, { recursive: true });
  ensureShared();
  for (const w of linkIntoProfile(dir)) console.error(colorize('yellow', `warn: ${w}`));
  syncFilesIntoProfile(dir);
  updateProfile(name, { lastUsed: new Date().toISOString() });

  writeJson(lockPath(name), { pid: process.pid, startedAt: new Date().toISOString() });
  const env = { ...process.env, CLAUDE_CONFIG_DIR: dir };
  let res = spawnSync('claude', args, { stdio: 'inherit', env });
  if (res.error?.code === 'ENOENT') {
    res = spawnSync('claude', args, { stdio: 'inherit', env, shell: true });
  }
  try { fs.rmSync(lockPath(name)); } catch {}
  refreshIdentity(name);

  if (res.error) {
    console.error(colorize('red', `error: could not start "claude" (${res.error.message}). Is Claude Code installed and on PATH?`));
    return 1;
  }
  return res.status ?? 0;
}
