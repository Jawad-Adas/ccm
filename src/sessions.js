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

// Sessions across all profiles + default, newest first, deduped by id
// (a moved session keeps only its most recent copy). With a slug: only that
// project folder. With slug = null: every project folder, entries tagged
// with their slug so callers can transfer/resume into the right project.
export function allSessions(slug = null) {
  const sources = [
    ...listProfiles().map((p) => ({ kind: 'profile', label: p.name, color: p.color, dir: profileDir(p.name) })),
    { kind: 'default', label: 'default', color: null, dir: DEFAULT_CLAUDE_DIR },
  ];
  const byId = new Map();
  for (const src of sources) {
    let slugs = slug ? [slug] : [];
    if (!slug) {
      try { slugs = fs.readdirSync(path.join(src.dir, 'projects')); } catch {}
    }
    for (const s of slugs) {
      for (const t of listTranscripts(src.dir, s)) {
        const prev = byId.get(t.id);
        if (!prev || t.mtime > prev.mtime || (t.mtime === prev.mtime && src.kind === 'profile' && prev.source.kind === 'default')) {
          byId.set(t.id, { ...t, slug: s, source: src });
        }
      }
    }
  }
  return [...byId.values()].sort((a, b) => b.mtime - a.mtime);
}

// Best-effort metadata from the transcript head (first 16KB, one read):
// title — a compaction summary if present, else the first user message;
// cwd — the directory the session belongs to (needed to resume it, since
// Claude Code scopes sessions per folder).
export function sessionMeta(file) {
  let head = '';
  try {
    const fd = fs.openSync(file, 'r');
    const buf = Buffer.alloc(49152);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    fs.closeSync(fd);
    head = buf.toString('utf8', 0, n);
  } catch { return { title: null, cwd: null }; }
  const clean = (s) => String(s).replace(/\s+/g, ' ').trim().slice(0, 80) || null;
  let title = null;
  let cwd = null;
  for (const line of head.split('\n')) {
    let obj;
    try { obj = JSON.parse(line); } catch { continue; }
    if (!cwd && typeof obj?.cwd === 'string') cwd = obj.cwd;
    if (!title && obj?.type === 'summary' && obj.summary) title = clean(obj.summary);
    const msg = obj?.message;
    if (!title && (obj?.type === 'user' || msg?.role === 'user') && msg?.content) {
      if (typeof msg.content === 'string') title = clean(msg.content);
      else title = clean(msg.content.find?.((c) => c?.type === 'text')?.text ?? '');
    }
    if (title && cwd) break;
  }
  return { title, cwd };
}

export function sessionTitle(file) {
  return sessionMeta(file).title;
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
