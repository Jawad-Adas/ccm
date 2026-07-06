import fs from 'node:fs';
import path from 'node:path';
import { profileDir, DEFAULT_CLAUDE_DIR } from './paths.js';
import { listProfiles } from './registry.js';

// Claude Code names each project's transcript folder after the absolute path
// with every non-alphanumeric character replaced by "-".
export function slugForPath(p) {
  return path.resolve(p).replace(/[^A-Za-z0-9]/g, '-');
}

// Directories that hold per-session artifacts keyed by session UUID.
const ARTIFACT_DIRS = ['file-history', 'sessions', 'session-data', 'tasks', 'todos'];

export function listTranscripts(baseDir, slug) {
  const dir = path.join(baseDir, 'projects', slug);
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names.filter((n) => n.endsWith('.jsonl')).map((n) => {
    const file = path.join(dir, n);
    return { id: n.slice(0, -'.jsonl'.length), file, mtime: fs.statSync(file).mtimeMs };
  });
}

// Find a session for this slug across all profiles (except the target) and
// the default ~/.claude. Exact id match wins; otherwise the most recent.
// Sources are labeled so the user can see where the session came from.
export function findSession(slug, id, excludeProfile) {
  const sources = [
    ...listProfiles().filter((p) => p.name !== excludeProfile)
      .map((p) => ({ kind: 'profile', label: p.name, dir: profileDir(p.name) })),
    { kind: 'default', label: '~/.claude (default)', dir: DEFAULT_CLAUDE_DIR },
  ];
  const candidates = [];
  for (const src of sources) {
    for (const t of listTranscripts(src.dir, slug)) {
      if (id && t.id !== id) continue;
      candidates.push({ ...t, source: src });
    }
  }
  if (!candidates.length) return null;
  // newest first; among equals prefer a profile over the default dir
  candidates.sort((a, b) => (b.mtime - a.mtime) || (a.source.kind === 'profile' ? -1 : 1));
  return candidates[0];
}

// Copy a session's transcript + artifacts into the target profile.
// The original is left in place on the source account.
export function copySessionTo(found, toName, slug) {
  const destBase = profileDir(toName);
  const destDir = path.join(destBase, 'projects', slug);
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(found.file, path.join(destDir, `${found.id}.jsonl`));
  let artifacts = 0;
  for (const base of ARTIFACT_DIRS) {
    const srcBase = path.join(found.source.dir, base);
    let entries = [];
    try { entries = fs.readdirSync(srcBase); } catch { continue; }
    for (const entry of entries.filter((e) => e.includes(found.id))) {
      try {
        fs.cpSync(path.join(srcBase, entry), path.join(destBase, base, entry), { recursive: true, force: true });
        artifacts++;
      } catch {}
    }
  }
  return { artifacts };
}
