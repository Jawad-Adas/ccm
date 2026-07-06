import fs from 'node:fs';
import path from 'node:path';
import { SHARED_DIR, DEFAULT_CLAUDE_DIR } from './paths.js';

// Directories junction-linked into every profile (configure once, all accounts see it).
export const SHARED_SUBDIRS = ['agents', 'skills', 'commands', 'hooks'];
// Files synced by copy on every launch (file symlinks need admin on Windows; copies don't).
export const SHARED_FILES = ['settings.json', 'CLAUDE.md'];

// Create ~/.ccm/shared, seeding each piece from ~/.claude the first time.
export function ensureShared() {
  fs.mkdirSync(SHARED_DIR, { recursive: true });
  for (const f of SHARED_FILES) {
    const src = path.join(DEFAULT_CLAUDE_DIR, f);
    const dst = path.join(SHARED_DIR, f);
    if (!fs.existsSync(dst) && fs.existsSync(src)) fs.copyFileSync(src, dst);
  }
  for (const d of SHARED_SUBDIRS) {
    const src = path.join(DEFAULT_CLAUDE_DIR, d);
    const dst = path.join(SHARED_DIR, d);
    if (fs.existsSync(dst)) continue;
    if (fs.existsSync(src)) fs.cpSync(src, dst, { recursive: true });
    else fs.mkdirSync(dst, { recursive: true });
  }
}

// Junction-link shared dirs into a profile. Anything already present is left alone.
export function linkIntoProfile(dir) {
  const warnings = [];
  for (const d of SHARED_SUBDIRS) {
    const link = path.join(dir, d);
    try {
      fs.lstatSync(link);
      continue;
    } catch {}
    const target = path.join(SHARED_DIR, d);
    try {
      fs.symlinkSync(target, link, 'junction');
    } catch (e) {
      try {
        fs.cpSync(target, link, { recursive: true });
        warnings.push(`could not junction ${d} (${e.code ?? e.message}); copied instead — edits won't be shared`);
      } catch (e2) {
        warnings.push(`could not provide ${d}: ${e2.message}`);
      }
    }
  }
  return warnings;
}

export function syncFilesIntoProfile(dir) {
  for (const f of SHARED_FILES) {
    const src = path.join(SHARED_DIR, f);
    const dst = path.join(dir, f);
    let s;
    try { s = fs.statSync(src); } catch { continue; }
    let d;
    try { d = fs.statSync(dst); } catch {}
    if (!d || s.mtimeMs > d.mtimeMs) fs.copyFileSync(src, dst);
  }
}

// Remove junctions before deleting a profile so rm can't touch shared content.
export function unlinkShared(dir) {
  for (const d of SHARED_SUBDIRS) {
    const link = path.join(dir, d);
    try {
      if (fs.lstatSync(link).isSymbolicLink()) fs.unlinkSync(link);
    } catch {}
  }
}
