import fs from 'node:fs';
import path from 'node:path';
import { WT_FRAGMENT, WT_FRAGMENT_DIR } from './paths.js';
import { readJson, writeJson } from './util.js';
import { listProfiles } from './registry.js';

// Windows Terminal "fragments" are the sanctioned way for apps to contribute
// profiles without touching the user's settings.json (which allows comments
// and is risky to rewrite). WT picks fragments up on its next launch.

const COLOR_HEX = {
  cyan: '#06B6D4', magenta: '#D946EF', yellow: '#EAB308',
  green: '#22C55E', blue: '#3B82F6', red: '#EF4444',
};

export function buildFragment(profiles) {
  return {
    profiles: profiles.map((p) => ({
      name: `Claude — ${p.name}`,
      commandline: `ccm ${p.name}`,
      tabColor: COLOR_HEX[p.color] ?? '#7C3AED',
      suppressApplicationTitle: false,
    })),
  };
}

export function wtDetected() {
  if (fs.existsSync(path.dirname(path.dirname(WT_FRAGMENT_DIR)))) return true;
  // Store-packaged WT has no "Windows Terminal" folder under %LOCALAPPDATA%\Microsoft
  // until first settings write — detect the package (or wt.exe shim) instead.
  const local = path.dirname(path.dirname(path.dirname(WT_FRAGMENT_DIR)));
  try {
    if (fs.readdirSync(path.join(local, 'Packages')).some((n) => n.startsWith('Microsoft.WindowsTerminal_'))) return true;
  } catch {}
  return fs.existsSync(path.join(local, 'Microsoft', 'WindowsApps', 'wt.exe'));
}

export function installWt() {
  writeJson(WT_FRAGMENT, buildFragment(listProfiles()));
  return WT_FRAGMENT;
}

export function uninstallWt() {
  if (!fs.existsSync(WT_FRAGMENT_DIR)) return false;
  fs.rmSync(WT_FRAGMENT_DIR, { recursive: true, force: true });
  return true;
}

export function wtInstalled() {
  return fs.existsSync(WT_FRAGMENT);
}

export function wtInSync() {
  return JSON.stringify(readJson(WT_FRAGMENT, null)) === JSON.stringify(buildFragment(listProfiles()));
}

// Keep the fragment current when profiles change, but only if it was installed.
export function refreshWtIfInstalled() {
  if (wtInstalled()) installWt();
}
