import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  CCM_HOME, CONFIG_PATH, SHARED_DIR, PROFILES_DIR, profileDir,
  overrideSettingsPath, overrideClaudeMdPath,
} from './paths.js';
import { readJson, colorize, bold, dim, timeUntil } from './util.js';
import { listProfiles } from './registry.js';
import { SHARED_SUBDIRS } from './shared.js';
import { readOauth, fetchUsage } from './usage.js';
import { wtDetected, wtInstalled, wtInSync } from './wt.js';

const ok = (msg) => ({ level: 'ok', msg });
const warn = (msg) => ({ level: 'warn', msg });
const err = (msg) => ({ level: 'err', msg });

function claudeVersion() {
  let r = spawnSync('claude', ['--version'], { encoding: 'utf8' });
  if (r.error?.code === 'ENOENT') r = spawnSync('claude', ['--version'], { encoding: 'utf8', shell: true });
  return r.status === 0 ? r.stdout.trim() : null;
}

function checkProfile(p) {
  const results = [];
  const dir = profileDir(p.name);
  if (!fs.existsSync(dir)) return [err(`profile dir missing: ${dir} — remove with: ccm remove ${p.name}`)];

  const oauth = readOauth(p.name);
  if (!oauth?.accessToken) results.push(warn('not logged in — launch it and run /login'));
  else if (oauth.expiresAt && oauth.expiresAt < Date.now()) {
    results.push(warn('token expired — refreshes automatically on next launch'));
  } else if (oauth.expiresAt) {
    results.push(ok(`token valid, expires in ${timeUntil(new Date(oauth.expiresAt).toISOString())}`));
  }
  if (!p.email) results.push(warn('identity unknown — launch once so ccm can read the account email'));

  for (const d of SHARED_SUBDIRS) {
    const link = path.join(dir, d);
    let st = null;
    try { st = fs.lstatSync(link); } catch {}
    if (!st) {
      try {
        fs.symlinkSync(path.join(SHARED_DIR, d), link, 'junction');
        results.push(ok(`re-created missing ${d} junction`));
      } catch (e) {
        results.push(err(`${d} junction missing and could not be created (${e.code ?? e.message})`));
      }
    } else if (st.isSymbolicLink()) {
      if (!fs.existsSync(link)) results.push(err(`${d} junction is broken (target gone)`));
    } else {
      results.push(warn(`${d} is a plain copy, not a junction — edits are not shared`));
    }
  }

  const lockFile = path.join(dir, 'ccm.lock');
  const lock = readJson(lockFile, null);
  if (lock?.pid) {
    let alive = false;
    try { process.kill(lock.pid, 0); alive = true; } catch {}
    if (alive) results.push(ok('session running'));
    else {
      try { fs.rmSync(lockFile); results.push(ok('cleaned stale lock file')); } catch {}
    }
  }

  const overrides = [];
  if (fs.existsSync(overrideSettingsPath(p.name))) overrides.push('settings');
  if (fs.existsSync(overrideClaudeMdPath(p.name))) overrides.push('CLAUDE.md');
  if (overrides.length) results.push(ok(`overrides active: ${overrides.join(', ')}`));
  return results;
}

// Structured results: [{group, level, msg}] — group '' = system-wide.
export async function collectDoctor() {
  const entries = [];
  const add = (group, r) => entries.push({ group, ...r });

  const version = claudeVersion();
  add('', version ? ok(`claude on PATH (${version})`) : err('claude not found on PATH — install Claude Code'));
  add('', fs.existsSync(CCM_HOME) ? ok(`ccm home: ${CCM_HOME}`) : err(`ccm home missing: ${CCM_HOME}`));
  add('', readJson(CONFIG_PATH, null)?.profiles ? ok('registry parses') : warn('registry missing/corrupt — will be rebuilt from profile dirs'));

  const sharedSettings = readJson(path.join(SHARED_DIR, 'settings.json'), null);
  add('', sharedSettings?.statusLine?.command === 'ccm statusline'
    ? ok('statusline integration installed')
    : warn('statusline not installed — run: ccm statusline install'));

  if (wtDetected()) {
    add('', !wtInstalled() ? warn('Windows Terminal fragment not installed — run: ccm wt install')
      : wtInSync() ? ok('Windows Terminal fragment in sync')
      : warn('Windows Terminal fragment out of date — run: ccm wt install'));
  }

  const profiles = listProfiles();
  if (!profiles.length) add('', warn('no profiles yet — run: ccm import <name>'));
  for (const p of profiles) {
    for (const r of checkProfile(p)) add(p.name, r);
  }

  const probe = profiles.find((p) => {
    const o = readOauth(p.name);
    return o?.accessToken && (!o.expiresAt || o.expiresAt > Date.now());
  });
  if (probe) {
    const res = await fetchUsage(probe.name);
    add('', res.windows ? ok('usage API reachable') : warn(`usage API: ${res.error}`));
  }

  let orphans = [];
  try {
    const known = new Set(profiles.map((p) => p.name));
    orphans = fs.readdirSync(PROFILES_DIR).filter((n) => !known.has(n));
  } catch {}
  if (orphans.length) add('', warn(`unregistered profile dirs: ${orphans.join(', ')}`));

  const failures = entries.filter((e) => e.level === 'err').length;
  return { entries, failures };
}

export async function runDoctor() {
  const { entries, failures } = await collectDoctor();
  const icon = { ok: colorize('green', '✔'), warn: colorize('yellow', '!'), err: colorize('red', '✖') };
  const lines = [];
  let lastGroup = '';
  for (const e of entries) {
    if (e.group && e.group !== lastGroup) lines.push(bold(e.group));
    lastGroup = e.group;
    lines.push(`${icon[e.level]} ${e.group ? dim(' ') : ''}${e.msg}`);
  }
  return { text: lines.join('\n'), failures, entries };
}
