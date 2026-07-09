import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { profileDir } from './paths.js';
import { readJson, writeJson, colorize, bold, dim } from './util.js';
import { getProfile, updateProfile, refreshIdentity } from './registry.js';
import { ensureShared, linkIntoProfile } from './shared.js';
import { composeProfile } from './compose.js';
import { authState, sameAccountValidSource } from './oauth.js';

// Returned by launchProfile when it refuses to start a logged-out account,
// so callers can tell "blocked" apart from a real Claude exit code.
export const LOGGED_OUT_EXIT = 4;

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
// opts.cwd runs the session in another folder (resuming a session from a
// different project must happen in that project's directory).
export function launchProfile(name, args = [], opts = {}) {
  if (!getProfile(name)) throw new Error(`unknown profile "${name}" — run: ccm list`);

  // Preflight: never hand off to a silent Claude login screen. If the saved
  // token was cleared, starting a session would just dead-end at /login — so
  // stop with an explanation instead. `intent: 'login'` (ccm login / add) is the
  // one path that WANTS the login screen and skips this.
  if (opts.intent !== 'login' && authState(name) === 'logged-out') {
    const other = sameAccountValidSource(name);
    console.error(colorize('yellow', `\n"${name}" is logged out — its saved token was cleared, so starting a session would just drop you at Claude's login screen.`));
    if (other) console.error(dim(`This account is still logged in via ${other}; using one account in two places rotates its single-use token and logs the other out.`));
    console.error(`Sign back in with:  ${bold(`ccm login ${name}`)}\n`);
    return LOGGED_OUT_EXIT;
  }

  const dir = profileDir(name);
  fs.mkdirSync(dir, { recursive: true });
  ensureShared();
  for (const w of [...linkIntoProfile(dir), ...composeProfile(name, dir)]) {
    console.error(colorize('yellow', `warn: ${w}`));
  }
  updateProfile(name, { lastUsed: new Date().toISOString() });

  writeJson(lockPath(name), { pid: process.pid, startedAt: new Date().toISOString() });
  const env = { ...process.env, CLAUDE_CONFIG_DIR: dir };
  const cwd = opts.cwd && fs.existsSync(opts.cwd) ? opts.cwd : undefined;
  let res = spawnSync('claude', args, { stdio: 'inherit', env, cwd });
  if (res.error?.code === 'ENOENT') {
    res = spawnSync('claude', args, { stdio: 'inherit', env, cwd, shell: true });
  }
  try { fs.rmSync(lockPath(name)); } catch {}
  refreshIdentity(name);

  if (res.error) {
    console.error(colorize('red', `error: could not start "claude" (${res.error.message}). Is Claude Code installed and on PATH?`));
    return 1;
  }
  return res.status ?? 0;
}
