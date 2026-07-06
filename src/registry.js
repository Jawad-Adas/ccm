import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_PATH, PROFILES_DIR, profileDir } from './paths.js';
import { readJson, writeJson } from './util.js';

const PALETTE = ['cyan', 'magenta', 'yellow', 'green', 'blue', 'red'];

export function loadConfig() {
  const cfg = readJson(CONFIG_PATH, null);
  if (cfg?.profiles) return cfg;
  // Rebuild from profile directories if the registry is missing or corrupt.
  const rebuilt = { profiles: {} };
  let names = [];
  try {
    names = fs.readdirSync(PROFILES_DIR).filter((n) =>
      fs.existsSync(path.join(PROFILES_DIR, n, '.credentials.json')) ||
      fs.existsSync(path.join(PROFILES_DIR, n, '.claude.json')));
  } catch {}
  for (const [i, name] of names.entries()) {
    rebuilt.profiles[name] = {
      email: null, displayName: null, organization: null, plan: null,
      color: PALETTE[i % PALETTE.length], createdAt: null, lastUsed: null,
    };
  }
  return rebuilt;
}

export function saveConfig(cfg) {
  writeJson(CONFIG_PATH, cfg);
}

export function validName(name) {
  return typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/.test(name);
}

export function listProfiles() {
  const cfg = loadConfig();
  return Object.entries(cfg.profiles).map(([name, p]) => ({ name, ...p }));
}

export function getProfile(name) {
  return loadConfig().profiles[name] ?? null;
}

// Command words can never be profile names — the CLI dispatches commands first.
const RESERVED = new Set([
  'add', 'import', 'list', 'ls', 'remove', 'rm', 'status', 'st', 'pick',
  'pin', 'unpin', 'statusline', 'refresh', 'help', 'version', 'doctor',
  'mcp', 'wt', 'notify', 'override', 'move-session', 'sessions', 'ui', 'board',
]);

export function registerProfile(name) {
  if (!validName(name)) throw new Error(`invalid profile name "${name}" (use letters, digits, - or _)`);
  if (RESERVED.has(name)) throw new Error(`"${name}" is a ccm command — pick another profile name`);
  const cfg = loadConfig();
  if (cfg.profiles[name]) throw new Error(`profile "${name}" already exists`);
  const used = new Set(Object.values(cfg.profiles).map((p) => p.color));
  const color = PALETTE.find((c) => !used.has(c)) ?? PALETTE[Object.keys(cfg.profiles).length % PALETTE.length];
  cfg.profiles[name] = {
    email: null, displayName: null, organization: null, plan: null,
    color, createdAt: new Date().toISOString(), lastUsed: null,
  };
  saveConfig(cfg);
  return cfg.profiles[name];
}

export function updateProfile(name, patch) {
  const cfg = loadConfig();
  if (!cfg.profiles[name]) return null;
  Object.assign(cfg.profiles[name], patch);
  saveConfig(cfg);
  return cfg.profiles[name];
}

export function unregisterProfile(name) {
  const cfg = loadConfig();
  delete cfg.profiles[name];
  saveConfig(cfg);
}

// Pull identity (email, org, plan) out of the profile's own files after a login.
export function refreshIdentity(name) {
  const dir = profileDir(name);
  const acct = readJson(path.join(dir, '.claude.json'), null)?.oauthAccount;
  const oauth = readJson(path.join(dir, '.credentials.json'), null)?.claudeAiOauth;
  const patch = {};
  if (acct) {
    patch.email = acct.emailAddress ?? null;
    patch.displayName = acct.displayName ?? null;
    patch.organization = acct.organizationName ?? null;
  }
  if (oauth?.subscriptionType) patch.plan = oauth.subscriptionType;
  return Object.keys(patch).length ? updateProfile(name, patch) : getProfile(name);
}
