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
// the default ~/.claude. Exact id match wins; otherwise the most recent
// user-facing session (an id can still target any transcript, but the
// "latest" pick skips SDK/subagent transcripts — you resume real chats).
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
  if (id) return candidates[0];
  return candidates.find((c) => isUserFacing(sessionMeta(c.file).entrypoint)) ?? candidates[0];
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

// A session is "user-facing" (shown by Claude Code's /resume) when it was
// started interactively — entrypoint "cli", "vscode", "desktop", etc. Sessions
// spawned programmatically (subagents, Task/workflow fan-out, the SDK) carry an
// "sdk*" entrypoint and are hidden from /resume; ccm hides them too.
export function isUserFacing(entrypoint) {
  return !entrypoint || !/^sdk/i.test(entrypoint);
}

const MAX_LINE = 65536;   // parse only reasonably-sized JSONL lines
const MAX_SCAN = 1 << 20; // stop scanning a transcript after 1 MB

// Best-effort metadata from the transcript head:
// title — a compaction summary if present, else the first user message;
// cwd — the directory the session belongs to (resume must run there);
// entrypoint — how the session was started (drives isUserFacing).
// Streams line-by-line and skips oversized lines (a big queue-operation blob
// can be the first line, pushing the entrypoint-bearing user line past a fixed
// read window — which would misclassify SDK subagent sessions as user-facing).
export function sessionMeta(file) {
  let fd;
  try { fd = fs.openSync(file, 'r'); } catch { return { title: null, cwd: null, entrypoint: null }; }
  const clean = (s) => String(s).replace(/\s+/g, ' ').trim().slice(0, 80) || null;
  let title = null;
  let cwd = null;
  let entrypoint = null;
  const consider = (line) => {
    if (!line || line.length > MAX_LINE) return; // skip blank/oversized lines
    let o;
    try { o = JSON.parse(line); } catch { return; }
    if (!cwd && typeof o?.cwd === 'string') cwd = o.cwd;
    if (!entrypoint && typeof o?.entrypoint === 'string') entrypoint = o.entrypoint;
    if (!title && o?.type === 'summary' && o.summary) title = clean(o.summary);
    const msg = o?.message;
    if (!title && (o?.type === 'user' || msg?.role === 'user') && msg?.content) {
      if (typeof msg.content === 'string') title = clean(msg.content);
      else title = clean(msg.content.find?.((c) => c?.type === 'text')?.text ?? '');
    }
  };
  const CH = 65536;
  const buf = Buffer.alloc(CH);
  let carry = '';
  let read = 0;
  try {
    while (read < MAX_SCAN) {
      const n = fs.readSync(fd, buf, 0, CH, read);
      if (n <= 0) break;
      read += n;
      carry += buf.toString('utf8', 0, n);
      let nl;
      while ((nl = carry.indexOf('\n')) >= 0) {
        consider(carry.slice(0, nl));
        carry = carry.slice(nl + 1);
        if (title && cwd && entrypoint) return { title, cwd, entrypoint };
      }
    }
    consider(carry);
  } catch { /* fall through with whatever we found */ } finally {
    try { fs.closeSync(fd); } catch {}
  }
  return { title, cwd, entrypoint };
}

export function sessionTitle(file) {
  return sessionMeta(file).title;
}

// User-facing sessions for a slug (or all folders when slug is null), each with
// metadata attached, newest first. Reads every candidate's head to classify by
// entrypoint and filter out subagent/SDK transcripts — this is what makes the
// count match Claude Code's own /resume.
export function listSessions(slug = null, { includeSdk = false } = {}) {
  return allSessions(slug)
    .map((s) => ({ ...s, ...sessionMeta(s.file) }))
    .filter((s) => includeSdk || isUserFacing(s.entrypoint));
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
