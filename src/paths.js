import os from 'node:os';
import path from 'node:path';

export const CCM_HOME = process.env.CCM_HOME || path.join(os.homedir(), '.ccm');
export const PROFILES_DIR = path.join(CCM_HOME, 'profiles');
export const SHARED_DIR = path.join(CCM_HOME, 'shared');
export const CONFIG_PATH = path.join(CCM_HOME, 'config.json');
export const CACHE_DIR = path.join(CCM_HOME, 'cache');
export const USAGE_CACHE = path.join(CACHE_DIR, 'usage.json');

export const DEFAULT_CLAUDE_DIR = process.env.CCM_CLAUDE_DIR || path.join(os.homedir(), '.claude');
export const HOME_CLAUDE_JSON = path.join(os.homedir(), '.claude.json');

export const OVERRIDES_DIR = path.join(CCM_HOME, 'overrides');
export const SHARED_MCP = path.join(SHARED_DIR, 'mcp.json');
export const NOTIFY_STATE = path.join(CACHE_DIR, 'notify-state.json');
export const MCP_RECORD_DIR = path.join(CACHE_DIR, 'mcp-injected');

const LOCALAPPDATA = process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local');
export const WT_FRAGMENT_DIR = path.join(LOCALAPPDATA, 'Microsoft', 'Windows Terminal', 'Fragments', 'ccm');
export const WT_FRAGMENT = path.join(WT_FRAGMENT_DIR, 'ccm.json');

export function profileDir(name) {
  return path.join(PROFILES_DIR, name);
}

export function overrideSettingsPath(name) {
  return path.join(OVERRIDES_DIR, `${name}.json`);
}

export function overrideClaudeMdPath(name) {
  return path.join(OVERRIDES_DIR, `${name}.CLAUDE.md`);
}
