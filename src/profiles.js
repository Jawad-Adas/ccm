// Profile directory setup shared by the CLI commands and the TUI.

import fs from 'node:fs';
import path from 'node:path';
import { profileDir, DEFAULT_CLAUDE_DIR, HOME_CLAUDE_JSON } from './paths.js';
import { ensureShared, linkIntoProfile, unlinkShared } from './shared.js';
import { composeProfile } from './compose.js';
import { unregisterProfile } from './registry.js';
import { isRunning } from './launch.js';

// Session state that must travel with an import for --resume/--continue to
// see past conversations: transcripts, prompt history, checkpoints, tasks.
export const HISTORY_ITEMS = ['projects', 'sessions', 'session-data', 'tasks', 'file-history', 'history.jsonl'];

// Create the profile's CLAUDE_CONFIG_DIR and compose the shared layer into it.
// Returns warnings (junction fallbacks etc.) for the caller to surface.
export function prepareProfileDir(name) {
  const dir = profileDir(name);
  fs.mkdirSync(dir, { recursive: true });
  ensureShared();
  return [...linkIntoProfile(dir), ...composeProfile(name, dir)];
}

export function hasDefaultLogin() {
  return fs.existsSync(path.join(DEFAULT_CLAUDE_DIR, '.credentials.json'));
}

// Delete a profile: unlink its shared junctions first (so the recursive delete
// can't follow them into ~/.ccm/shared), remove its CLAUDE_CONFIG_DIR, then drop
// it from the registry. Refuses while a session is live — its files are in use.
export function removeProfile(name) {
  if (isRunning(name)) throw new Error(`profile "${name}" has a running session — close it first`);
  const dir = profileDir(name);
  unlinkShared(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  unregisterProfile(name);
}

// Copy the default ~/.claude login (and optionally its session history)
// into an already-prepared profile.
export function importDefaultInto(name, { withHistory = true } = {}) {
  const dir = profileDir(name);
  fs.copyFileSync(path.join(DEFAULT_CLAUDE_DIR, '.credentials.json'), path.join(dir, '.credentials.json'));
  if (fs.existsSync(HOME_CLAUDE_JSON)) fs.copyFileSync(HOME_CLAUDE_JSON, path.join(dir, '.claude.json'));
  if (!withHistory) return;
  for (const item of HISTORY_ITEMS) {
    const src = path.join(DEFAULT_CLAUDE_DIR, item);
    if (fs.existsSync(src)) fs.cpSync(src, path.join(dir, item), { recursive: true, force: true });
  }
}
