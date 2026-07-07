// ccm ui — the Solari board as a local web page. Zero-dep http server bound
// to 127.0.0.1 with a Host allowlist (blocks DNS-rebinding). Launching an
// account opens a new Windows Terminal tab running `ccm <name>`.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { listProfiles, getProfile } from '../registry.js';
import { getUsage, refreshAll, headroom, isStale } from '../usage.js';
import { isRunning } from '../launch.js';
import os from 'node:os';
import { slugForPath, allSessions, sessionMeta, copySessionTo } from '../sessions.js';
import { collectDoctor } from '../doctor.js';
import { HUES } from '../tui/theme.js';

const PAGE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'board.html');

function json(res, obj, code = 200) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 65536) req.destroy(); });
    req.on('end', () => resolve(data));
  });
}

function shortDir(dir) {
  if (!dir) return null;
  return dir.startsWith(os.homedir()) ? '~' + dir.slice(os.homedir().length) : dir;
}

async function stateJson(cwd, scope = 'here') {
  const profiles = await Promise.all(listProfiles().map(async (p) => {
    const usage = await getUsage(p.name).catch(() => null);
    return {
      name: p.name, email: p.email, plan: p.plan, organization: p.organization,
      color: p.color, hue: HUES[p.color] ?? '#C3C2B7',
      running: isRunning(p.name), headroom: headroom(usage),
      windows: usage?.windows ?? null, usageError: usage?.error ?? null,
      stale: !!usage && (!!usage.staleError || isStale(usage)),
      staleError: usage?.staleError ?? null,
      fetchedAt: usage?.fetchedAt ?? null,
      lastUsed: p.lastUsed,
    };
  }));
  profiles.sort((a, b) => (b.headroom ?? -1) - (a.headroom ?? -1));
  const sessions = allSessions(scope === 'all' ? null : slugForPath(cwd)).slice(0, scope === 'all' ? 200 : 20)
    .map((s) => {
      const meta = sessionMeta(s.file);
      return {
        id: s.id, mtime: s.mtime, title: meta.title,
        dir: meta.cwd, dirShort: shortDir(meta.cwd) ?? s.slug,
        source: { kind: s.source.kind, label: s.source.label, hue: HUES[s.source.color] ?? null },
      };
    });
  return { profiles, sessions, scope, cwd, now: Date.now() };
}

function openTerminal(args, dir = null) {
  const child = spawn('wt.exe', dir ? ['-d', dir, ...args] : args, { detached: true, stdio: 'ignore' });
  child.on('error', () => {
    spawn('cmd.exe', ['/c', 'start', '', 'cmd', '/k', ...args], {
      detached: true, stdio: 'ignore', windowsHide: false, cwd: dir ?? undefined,
    }).unref();
  });
  child.unref();
}

export function startUi({ port = 7788, open = true, cwd = process.cwd() } = {}) {
  const server = http.createServer(async (req, res) => {
    try {
      const host = req.headers.host ?? '';
      if (!/^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(host)) return json(res, { error: 'forbidden' }, 403);
      const u = new URL(req.url, 'http://localhost');

      if (req.method === 'GET' && u.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(fs.readFileSync(PAGE));
      }
      if (req.method === 'GET' && u.pathname === '/api/state') {
        return json(res, await stateJson(cwd, u.searchParams.get('scope') === 'all' ? 'all' : 'here'));
      }
      if (req.method === 'GET' && u.pathname === '/api/doctor') return json(res, await collectDoctor());

      if (req.method === 'POST') {
        const body = JSON.parse(await readBody(req) || '{}');
        if (u.pathname === '/api/refresh') {
          await refreshAll(listProfiles().map((p) => p.name));
          return json(res, await stateJson(cwd, body.scope === 'all' ? 'all' : 'here'));
        }
        if (u.pathname === '/api/launch') {
          if (!getProfile(body.name)) return json(res, { error: `unknown profile "${body.name}"` }, 400);
          const args = ['ccm', body.name];
          if (body.resume) args.push('--resume', String(body.resume));
          openTerminal(args, body.dir && fs.existsSync(body.dir) ? body.dir : null);
          return json(res, { ok: true });
        }
        if (u.pathname === '/api/move') {
          if (!getProfile(body.to)) return json(res, { error: `unknown profile "${body.to}"` }, 400);
          const found = allSessions(null).find((s) => s.id === body.id);
          if (!found) return json(res, { error: 'session not found' }, 404);
          copySessionTo(found, body.to, found.slug);
          return json(res, { ok: true, resume: found.id, to: body.to });
        }
      }
      json(res, { error: 'not found' }, 404);
    } catch (e) {
      json(res, { error: e.message }, 500);
    }
  });

  server.listen(port, '127.0.0.1', () => {
    const addr = `http://127.0.0.1:${port}`;
    console.log(`ccm board: ${addr}   (ctrl+c to stop)`);
    if (open) spawn('cmd.exe', ['/c', 'start', '', addr], { detached: true, stdio: 'ignore' }).unref();
  });
  server.on('error', (e) => {
    console.error(e.code === 'EADDRINUSE' ? `port ${port} is busy — try: ccm ui --port ${port + 1}` : e.message);
    process.exitCode = 1;
  });
  return server;
}
