// Shared auto-memory: Claude Code keeps learned facts per project inside each
// config dir (projects/<slug>/memory). ccm pools them in ~/.ccm/shared/memory
// and junction-links each profile's project memory to the pool, so what
// Claude learns about a repo on one account is known on every account.
// The memory follows the repo, not the account.

import fs from 'node:fs';
import path from 'node:path';
import { SHARED_DIR, DEFAULT_CLAUDE_DIR } from './paths.js';

export const SHARED_MEMORY_DIR = path.join(SHARED_DIR, 'memory');

// Copy files from src that are missing in dst or newer than dst's copy.
function mergeInto(srcDir, dstDir) {
  fs.mkdirSync(dstDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, entry.name);
    const d = path.join(dstDir, entry.name);
    if (entry.isDirectory()) { mergeInto(s, d); continue; }
    if (!entry.isFile()) continue;
    let dst;
    try { dst = fs.statSync(d); } catch {}
    if (!dst || fs.statSync(s).mtimeMs > dst.mtimeMs) fs.copyFileSync(s, d);
  }
}

// One-time-per-project seeding from the untouched default ~/.claude, so the
// pool starts with what the default install already learned. ~/.claude itself
// is never linked or modified.
export function seedFromDefault() {
  let slugs = [];
  try { slugs = fs.readdirSync(path.join(DEFAULT_CLAUDE_DIR, 'projects')); } catch { return; }
  for (const slug of slugs) {
    const src = path.join(DEFAULT_CLAUDE_DIR, 'projects', slug, 'memory');
    const target = path.join(SHARED_MEMORY_DIR, slug);
    if (fs.existsSync(src) && !fs.existsSync(target)) mergeInto(src, target);
  }
}

// Sweep a profile's project folders at launch. mode 'shared': local memory is
// merged into the pool (original kept as memory.bak) and replaced with a
// junction; projects with pooled memory get linked as soon as the profile has
// visited them. mode 'private': junctions are replaced with a real copy of
// the pool — the profile's memory forks from there.
export function syncMemory(dir, mode = 'shared') {
  const warnings = [];
  const projects = path.join(dir, 'projects');
  let slugs = [];
  try { slugs = fs.readdirSync(projects); } catch { return warnings; }
  for (const slug of slugs) {
    const slugDir = path.join(projects, slug);
    try { if (!fs.lstatSync(slugDir).isDirectory()) continue; } catch { continue; }
    const local = path.join(slugDir, 'memory');
    const target = path.join(SHARED_MEMORY_DIR, slug);
    let st = null;
    try { st = fs.lstatSync(local); } catch {}

    if (mode === 'private') {
      if (st?.isSymbolicLink()) {
        try {
          fs.unlinkSync(local);
          if (fs.existsSync(target)) fs.cpSync(target, local, { recursive: true });
        } catch (e) { warnings.push(`memory: could not detach ${slug} (${e.code ?? e.message})`); }
      }
      continue;
    }

    if (st?.isSymbolicLink()) continue; // already pooled
    if (st) {
      // real local memory → merge into the pool, keep the original as a backup
      try {
        mergeInto(local, target);
        const bak = path.join(slugDir, 'memory.bak');
        fs.rmSync(bak, { recursive: true, force: true });
        fs.renameSync(local, bak);
      } catch (e) {
        warnings.push(`memory: could not pool ${slug} (${e.code ?? e.message})`);
        continue;
      }
    } else if (!fs.existsSync(target)) {
      continue; // no memory anywhere for this project yet
    }
    try {
      fs.symlinkSync(target, local, 'junction');
    } catch (e) {
      warnings.push(`memory: could not junction ${slug} (${e.code ?? e.message})`);
      const bak = path.join(slugDir, 'memory.bak');
      if (!fs.existsSync(local) && fs.existsSync(bak)) {
        try { fs.renameSync(bak, local); } catch {}
      }
    }
  }
  return warnings;
}

// Doctor/status helper: how many of this profile's projects are pooled.
export function memoryStatus(dir) {
  const projects = path.join(dir, 'projects');
  let linked = 0;
  let local = 0;
  let slugs = [];
  try { slugs = fs.readdirSync(projects); } catch {}
  for (const slug of slugs) {
    try {
      const st = fs.lstatSync(path.join(projects, slug, 'memory'));
      if (st.isSymbolicLink()) linked++;
      else if (st.isDirectory()) local++;
    } catch {}
  }
  return { linked, local };
}
