import os from 'node:os';
import path from 'node:path';

export const CCM_HOME = process.env.CCM_HOME || path.join(os.homedir(), '.ccm');
export const PROFILES_DIR = path.join(CCM_HOME, 'profiles');
export const SHARED_DIR = path.join(CCM_HOME, 'shared');
export const CONFIG_PATH = path.join(CCM_HOME, 'config.json');
export const CACHE_DIR = path.join(CCM_HOME, 'cache');
export const USAGE_CACHE = path.join(CACHE_DIR, 'usage.json');

export const DEFAULT_CLAUDE_DIR = path.join(os.homedir(), '.claude');
export const HOME_CLAUDE_JSON = path.join(os.homedir(), '.claude.json');

export function profileDir(name) {
  return path.join(PROFILES_DIR, name);
}
