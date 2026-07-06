// ccm's face: a split-flap departure board for Claude Code accounts.
// Views: board (accounts) · departures (sessions for this folder) · doctor.

import { Screen, Canvas } from './term.js';
import { Cascade, WORDMARK, drawMeter, METER_TILES } from './flap.js';
import { INK, INK2, MUTED, AMBER, GOOD, CRITICAL, hueOf, meterColor } from './theme.js';
import { listProfiles, registerProfile, refreshIdentity } from '../registry.js';
import { prepareProfileDir, hasDefaultLogin, importDefaultInto } from '../profiles.js';
import { refreshWtIfInstalled } from '../wt.js';
import { loadCache, refreshAll, headroom, ERROR_HINTS, DEFAULT_MAX_AGE_MS } from '../usage.js';
import { isRunning, launchProfile } from '../launch.js';
import { sortByHeadroom } from '../picker.js';
import os from 'node:os';
import { slugForPath, allSessions, sessionMeta, copySessionTo } from '../sessions.js';
import { collectDoctor } from '../doctor.js';
import { timeAgo, timeUntil } from '../util.js';

const S = {
  ink: { fg: INK }, inkB: { fg: INK, bold: true }, ink2: { fg: INK2 },
  muted: { fg: MUTED }, seam: { fg: MUTED, dim: true },
  amber: { fg: AMBER }, amberB: { fg: AMBER, bold: true },
  good: { fg: GOOD }, crit: { fg: CRITICAL, bold: true },
};

function sessionWindows(usage) {
  const find = (pred) => (usage?.windows ?? []).find(pred);
  return {
    fiveH: find((w) => w.label.startsWith('session')),
    week: find((w) => w.label === 'week (all models)'),
  };
}

function chipFor(p, usage, isBest) {
  if (isRunning(p.name)) return { text: '● IN SESSION', style: S.good };
  const worst = Math.max(0, ...(usage?.windows ?? []).map((w) => w.percent));
  if (worst >= 95) return { text: '■ FULL', style: S.crit };
  if (worst >= 80) return { text: '▲ ALMOST FULL', style: S.amber };
  if (isBest) return { text: '✦ MOST HEADROOM', style: S.good };
  return null;
}

// Pure board renderer — headless-testable.
export function renderBoard(state, w, h) {
  const c = new Canvas(w, h);
  const { profiles, cache, sel, clock, msg, spin } = state;

  WORDMARK.forEach((row, i) => c.put(2, i, row, i === 1 ? S.seam : S.ink));
  c.put(w - 2 - clock.length, 0, clock, S.amberB);
  if (spin) c.put(w - 12, 1, 'FETCHING…', S.muted);
  else if (msg) c.put(w - 2 - msg.length, 1, msg, S.ink2);
  c.put(2, 3, [...'CLAUDE CODE ACCOUNT BOARD'].join(' '), S.amber);
  c.put(2, 4, '─'.repeat(w - 4), S.seam);

  if (!profiles.length) {
    c.put(4, 7, 'NO ACCOUNTS ON THE BOARD', S.inkB);
    c.put(4, 9, 'Press ', S.ink2);
    c.put(10, 9, 'a', S.amberB);
    c.put(12, 9, 'to add your first account.', S.ink2);
  }

  const rowH = h >= 6 + profiles.length * 4 + 2 ? 4 : 3;
  let y = 6;
  const bestName = profiles.length > 1 && headroom(cache[profiles[0]?.name]) != null ? profiles[0].name : null;
  for (const [i, p] of profiles.entries()) {
    if (y + 3 > h - 2) break;
    const usage = cache[p.name];
    const selMark = i === sel;
    c.put(2, y, selMark ? '▌' : ' ', S.amberB);
    c.put(4, y, '●', { fg: hueOf(p.color) });
    c.put(6, y, p.name.toUpperCase().padEnd(13), selMark ? S.inkB : S.ink);
    c.put(20, y, (p.email ?? 'not logged in').padEnd(28), selMark ? S.ink2 : S.muted);
    if (p.plan) c.put(49, y, p.plan.toUpperCase(), S.muted);
    const chip = chipFor(p, usage, p.name === bestName);
    if (chip) c.put(w - 2 - chip.text.length, y, chip.text, chip.style);

    const { fiveH, week } = sessionWindows(usage);
    const meterRow = (yy, label, win) => {
      c.put(6, yy, label, S.muted);
      if (!win) {
        c.put(11, yy, usage?.error ? (ERROR_HINTS[usage.error] ?? usage.error) : 'no usage data — press r', S.seam);
        return;
      }
      const end = drawMeter(c, 11, yy, win.percent, { fg: meterColor(win.percent) }, S.seam);
      c.put(end + 1, yy, `${String(Math.round(win.percent)).padStart(3)}%`, S.ink2);
      c.put(end + 7, yy, 'RESETS', S.muted);
      c.put(end + 14, yy, timeUntil(win.resetsAt).toUpperCase(), S.amber);
    };
    meterRow(y + 1, '5H', fiveH);
    meterRow(y + 2, 'WK', week);
    y += rowH;
  }

  c.put(2, h - 2, '─'.repeat(w - 4), S.seam);
  drawKeybar(c, h - 1, [['↑↓', 'select'], ['enter', 'board'], ['a', 'add account'], ['s', 'departures'], ['r', 'refresh'], ['d', 'doctor'], ['q', 'quit']]);
  return c;
}

function drawKeybar(c, y, keys) {
  let x = 2;
  for (const [k, label] of keys) {
    c.put(x, y, k, S.amber);
    x += k.length + 1;
    c.put(x, y, label, S.muted);
    x += label.length + 3;
  }
}

function shortDir(dir, max = 60) {
  if (!dir) return '?';
  const short = dir.replace(/\\+$/, '').startsWith(os.homedir()) ? '~' + dir.slice(os.homedir().length) : dir;
  return short.length > max ? '…' + short.slice(-(max - 1)) : short;
}

// Rows for the departures view. This-folder scope: a flat session list.
// All-folders scope: sessions grouped under collapsible folder headers,
// groups ordered by their newest session. openDirs = Set of expanded dirs
// (null → only the newest folder starts open).
export function buildSessionRows(sessions, scope, openDirs = null) {
  if (scope !== 'all') return (sessions ?? []).map((s) => ({ type: 'session', s }));
  const groups = new Map();
  for (const s of sessions ?? []) {
    const dir = shortDir(s.cwd ?? s.slug);
    if (!groups.has(dir)) groups.set(dir, []);
    groups.get(dir).push(s);
  }
  const ordered = [...groups.entries()].sort((a, b) => b[1][0].mtime - a[1][0].mtime);
  const open = openDirs ?? new Set(ordered.slice(0, 1).map(([dir]) => dir));
  const rows = [];
  for (const [dir, list] of ordered) {
    rows.push({ type: 'group', dir, count: list.length, latest: list[0].mtime, open: open.has(dir) });
    if (open.has(dir)) for (const s of list) rows.push({ type: 'session', s, grouped: true });
  }
  return rows;
}

function drawSessionRow(c, y, w, row, selMark) {
  const s = row.s;
  const x = row.grouped ? 5 : 2;
  c.put(x, y, selMark ? '▌' : ' ', S.amberB);
  c.put(x + 2, y, s.source.kind === 'profile' ? '●' : '○', s.source.kind === 'profile' ? { fg: hueOf(s.source.color) } : S.muted);
  c.put(x + 4, y, timeAgo(new Date(s.mtime).toISOString()).padEnd(11), S.ink2);
  c.put(x + 16, y, s.source.label.padEnd(10), S.muted);
  const titleW = Math.max(0, w - x - 40);
  if (s.title) c.put(x + 27, y, s.title.slice(0, titleW), selMark ? S.ink : S.ink2);
  else c.put(x + 27, y, 'untitled', S.seam);
  c.put(w - 11, y, s.id.slice(0, 8), selMark ? S.ink2 : S.seam);
}

function drawGroupRow(c, y, w, row, selMark) {
  c.put(2, y, selMark ? '▌' : ' ', S.amberB);
  c.put(4, y, row.open ? '▾' : '▸', S.amber);
  c.put(6, y, row.dir.slice(0, w - 46), selMark ? S.inkB : S.ink);
  const meta = `${row.count} SESSION${row.count === 1 ? '' : 'S'} · ${timeAgo(new Date(row.latest).toISOString()).toUpperCase()}`;
  c.put(w - 2 - meta.length, y, meta, S.muted);
}

export function renderSessions(state, w, h) {
  const c = new Canvas(w, h);
  const all = state.scope === 'all';
  const rows = state.rows ?? [];
  const total = rows.filter((r) => r.type === 'session').length + (all ? 0 : 0);
  c.put(2, 0, 'DEPARTURES', S.amberB);
  c.put(14, 0, all ? `ALL FOLDERS · ${state.total ?? total} SESSIONS` : state.cwd.toUpperCase(), S.muted);
  c.put(w - 2 - state.clock.length, 0, state.clock, S.amberB);
  c.put(2, 1, '─'.repeat(w - 4), S.seam);
  if (!rows.length) {
    c.put(4, 3, all ? 'NO SESSIONS ON ANY ACCOUNT' : 'NO SESSIONS FOR THIS FOLDER', S.inkB);
    c.put(4, 5, all ? 'Sessions appear here once you have worked with Claude Code.'
      : 'Press a to see every folder, or work with Claude Code here first.', S.ink2);
  }
  const viewH = h - 6;
  const top = state.scrollTop ?? 0;
  for (let i = 0; i < viewH && top + i < rows.length; i++) {
    const row = rows[top + i];
    const y = 3 + i;
    const selMark = top + i === state.sel;
    if (row.type === 'group') drawGroupRow(c, y, w, row, selMark);
    else drawSessionRow(c, y, w, row, selMark);
  }
  if (top > 0) c.put(w - 4, 2, '▲', S.muted);
  if (top + viewH < rows.length) c.put(w - 4, h - 3, `▼ ${rows.length - top - viewH}`, S.muted);
  c.put(2, h - 2, '─'.repeat(w - 4), S.seam);
  drawKeybar(c, h - 1, [['↑↓', 'select'], ['enter', all ? 'resume / fold' : 'resume'], ['m', 'transfer'], ['a', all ? 'this folder' : 'all folders'], ['esc', 'board']]);
  return c;
}

export function renderDoctor(state, w, h) {
  const c = new Canvas(w, h);
  c.put(2, 0, 'DOCTOR', S.amberB);
  c.put(w - 2 - state.clock.length, 0, state.clock, S.amberB);
  c.put(2, 1, '─'.repeat(w - 4), S.seam);
  if (!state.doctor) {
    c.put(4, 3, 'RUNNING CHECKS…', S.ink2);
  } else {
    const lamp = { ok: ['●', S.good], warn: ['▲', S.amber], err: ['■', S.crit] };
    let y = 3;
    let lastGroup = '';
    for (const e of state.doctor.entries) {
      if (y > h - 3) break;
      if (e.group && e.group !== lastGroup) {
        c.put(4, y, e.group.toUpperCase(), S.inkB);
        y += 1;
      }
      lastGroup = e.group;
      const [g, st] = lamp[e.level];
      c.put(e.group ? 6 : 4, y, g, st);
      c.put(e.group ? 8 : 6, y, e.msg.slice(0, w - 10), S.ink2);
      y += 1;
    }
  }
  c.put(2, h - 2, '─'.repeat(w - 4), S.seam);
  drawKeybar(c, h - 1, [['r', 'run again'], ['esc', 'board']]);
  return c;
}

function drawBox(c, w, h, ow, oh) {
  const x0 = Math.max(1, ((w - ow) / 2) | 0);
  const y0 = Math.max(1, ((h - oh) / 2) | 0);
  for (let y = y0; y < y0 + oh; y++) c.put(x0, y, ' '.repeat(ow));
  c.put(x0, y0, '╭' + '─'.repeat(ow - 2) + '╮', S.amber);
  for (let y = y0 + 1; y < y0 + oh - 1; y++) {
    c.put(x0, y, '│', S.amber);
    c.put(x0 + ow - 1, y, '│', S.amber);
  }
  c.put(x0, y0 + oh - 1, '╰' + '─'.repeat(ow - 2) + '╯', S.amber);
  return { x0, y0 };
}

function drawOverlay(c, w, h, state) {
  const o = state.overlay;
  if (o.kind === 'transfer') {
    const { x0, y0 } = drawBox(c, w, h, 44, o.targets.length + 4);
    c.put(x0 + 2, y0 + 1, `TRANSFER ${o.session.id.slice(0, 8)} TO`, S.amberB);
    o.targets.forEach((t, i) => {
      const y = y0 + 2 + i;
      c.put(x0 + 2, y, i === o.sel ? '▌' : ' ', S.amberB);
      c.put(x0 + 4, y, '●', { fg: hueOf(t.color) });
      c.put(x0 + 6, y, t.name.toUpperCase(), i === o.sel ? S.inkB : S.ink);
    });
    return;
  }
  if (o.kind === 'add-name') {
    const { x0, y0 } = drawBox(c, w, h, 52, o.error ? 7 : 6);
    c.put(x0 + 2, y0 + 1, 'NEW ACCOUNT — NAME', S.amberB);
    c.put(x0 + 2, y0 + 3, '> ', S.muted);
    c.put(x0 + 4, y0 + 3, o.value, S.inkB);
    c.put(x0 + 4 + o.value.length, y0 + 3, '█', S.amber);
    if (o.error) c.put(x0 + 2, y0 + 4, o.error.slice(0, 48), S.crit);
    c.put(x0 + 2, y0 + (o.error ? 5 : 4), 'letters, digits, - and _ · enter next · esc cancel', S.seam);
    return;
  }
  if (o.kind === 'add-method') {
    const { x0, y0 } = drawBox(c, w, h, 58, o.options.length + 5);
    c.put(x0 + 2, y0 + 1, `ADD ${o.name.toUpperCase()} — HOW?`, S.amberB);
    o.options.forEach((opt, i) => {
      const y = y0 + 3 + i;
      c.put(x0 + 2, y, i === o.sel ? '▌' : ' ', S.amberB);
      c.put(x0 + 4, y, opt.label, i === o.sel ? S.inkB : S.ink);
    });
    c.put(x0 + 2, y0 + o.options.length + 3, 'enter confirm · esc back', S.seam);
  }
}

class App {
  constructor() {
    this.screen = new Screen();
    this.view = 'board';
    this.sel = 0;
    this.msg = null;
    this.spin = false;
    this.cascade = new Cascade();
    this.profiles = [];
    this.cache = {};
    this.sessions = null;
    this.doctor = null;
    this.overlay = null;
    this.cwd = process.cwd();
    this.scope = 'here';
    this.rows = [];
    this.openDirs = null;
    this.scrollTop = 0;
    this.lastClock = '';
  }

  clock() {
    return new Date().toTimeString().slice(0, 8);
  }

  run() {
    return new Promise((resolve) => {
      this.done = resolve;
      this.loadData();
      this.screen.onKey = (k, raw) => { try { this.key(k, raw); } catch { this.quit(1); } };
      this.screen.onResize = () => this.render();
      this.screen.enter();
      this.timer = setInterval(() => this.tick(), 100);
      this.render();
      this.refresh(false);
    });
  }

  quit(code = 0) {
    clearInterval(this.timer);
    this.screen.leave();
    this.done(code);
  }

  loadData() {
    this.cache = loadCache();
    this.profiles = sortByHeadroom(listProfiles(), this.cache);
    this.sel = Math.min(this.sel, Math.max(0, this.profiles.length - 1));
  }

  async refresh(force = true) {
    this.spin = true;
    this.render();
    try { await refreshAll(this.profiles.map((p) => p.name), force ? 0 : DEFAULT_MAX_AGE_MS); } catch {}
    this.spin = false;
    this.loadData();
    this.cascade = new Cascade();
    this.render();
  }

  loadSessions() {
    this.sessions = allSessions(this.scope === 'all' ? null : slugForPath(this.cwd))
      .slice(0, this.scope === 'all' ? 200 : 40)
      .map((s) => ({ ...s, ...sessionMeta(s.file) }));
    this.rebuildRows();
    this.sel = 0;
    this.scrollTop = 0;
  }

  rebuildRows(keepDir = null) {
    this.rows = buildSessionRows(this.sessions, this.scope, this.openDirs);
    if (this.openDirs === null && this.scope === 'all') {
      this.openDirs = new Set(this.rows.filter((r) => r.type === 'group' && r.open).map((r) => r.dir));
    }
    if (keepDir != null) {
      const i = this.rows.findIndex((r) => r.type === 'group' && r.dir === keepDir);
      if (i >= 0) this.sel = i;
    }
    this.sel = Math.min(this.sel, Math.max(0, this.rows.length - 1));
    this.ensureVisible();
  }

  ensureVisible() {
    const viewH = Math.max(1, this.screen.size.h - 6);
    if (this.sel < this.scrollTop) this.scrollTop = this.sel;
    if (this.sel >= this.scrollTop + viewH) this.scrollTop = this.sel - viewH + 1;
  }

  toggleGroup(row) {
    if (this.openDirs.has(row.dir)) this.openDirs.delete(row.dir);
    else this.openDirs.add(row.dir);
    this.rebuildRows(row.dir);
    this.render();
  }

  groupOf(index) {
    for (let i = index; i >= 0; i--) if (this.rows[i].type === 'group') return this.rows[i];
    return null;
  }

  launch(name, args = [], opts = {}) {
    clearInterval(this.timer);
    this.screen.leave();
    launchProfile(name, args, opts);
    this.screen.enter();
    this.timer = setInterval(() => this.tick(), 100);
    this.msg = `SESSION ENDED ${this.clock().slice(0, 5)}`;
    this.view = 'board';
    this.sel = 0;
    this.loadData();
    this.cascade = new Cascade();
    this.render();
  }

  key(k, raw) {
    if (k === 'ctrl-c') return this.quit(0);
    if (this.overlay) return this.keyOverlay(k, raw);
    if (this.view === 'board') return this.keyBoard(k);
    if (this.view === 'sessions') return this.keySessions(k);
    if (this.view === 'doctor') return this.keyDoctor(k);
  }

  move(delta, count) {
    if (!count) return;
    this.sel = (this.sel + delta + count) % count;
    this.render();
  }

  keyBoard(k) {
    this.msg = null;
    if (k === 'q' || k === 'esc') return this.quit(0);
    if (k === 'up' || k === 'k') return this.move(-1, this.profiles.length);
    if (k === 'down' || k === 'j' || k === 'tab') return this.move(1, this.profiles.length);
    if (k === 'r') return this.refresh(true);
    if (k === 'a' || k === '+') {
      this.overlay = { kind: 'add-name', value: '', error: null };
      return this.render();
    }
    if (k === 's' || k === 'm') {
      this.view = 'sessions';
      this.loadSessions();
      this.cascade = new Cascade();
      return this.render();
    }
    if (k === 'd') {
      this.view = 'doctor';
      this.doctor = null;
      this.render();
      collectDoctor().then((d) => { this.doctor = d; if (this.view === 'doctor') this.render(); });
      return;
    }
    if (k === 'enter' && this.profiles[this.sel]) return this.launch(this.profiles[this.sel].name);
    if (/^[1-9]$/.test(k) && +k <= this.profiles.length) return this.launch(this.profiles[+k - 1].name);
  }

  keySessions(k) {
    if (k === 'esc' || k === 'q') { this.view = 'board'; this.sel = 0; return this.render(); }
    if (k === 'up' || k === 'k') { this.move(-1, this.rows.length); return this.ensureVisible(), this.render(); }
    if (k === 'down' || k === 'j') { this.move(1, this.rows.length); return this.ensureVisible(), this.render(); }
    if (k === 'a') {
      this.scope = this.scope === 'all' ? 'here' : 'all';
      this.openDirs = null;
      this.loadSessions();
      this.cascade = new Cascade();
      return this.render();
    }
    const row = this.rows[this.sel];
    if (!row) return;
    if (row.type === 'group') {
      if (k === 'enter' || (k === 'right' && !row.open) || (k === 'left' && row.open)) return this.toggleGroup(row);
      return;
    }
    const s = row.s;
    if (k === 'left' && row.grouped) {
      const g = this.groupOf(this.sel);
      if (g) return this.toggleGroup(g);
    }
    if (k === 'enter') {
      if (s.source.kind === 'profile') return this.launch(s.source.label, ['--resume', s.id], { cwd: s.cwd });
      return this.openTransfer(s); // default-dir sessions board via a profile
    }
    if (k === 'm') return this.openTransfer(s);
  }

  keyDoctor(k) {
    if (k === 'esc' || k === 'q') { this.view = 'board'; return this.render(); }
    if (k === 'r') {
      this.doctor = null;
      this.render();
      collectDoctor().then((d) => { this.doctor = d; if (this.view === 'doctor') this.render(); });
    }
  }

  openTransfer(session) {
    const targets = listProfiles().filter((p) => !(session.source.kind === 'profile' && p.name === session.source.label));
    if (!targets.length) return;
    this.overlay = { kind: 'transfer', session, targets, sel: 0 };
    this.render();
  }

  keyOverlay(k, raw) {
    const o = this.overlay;
    if (o.kind === 'add-name') return this.keyAddName(k, raw);
    if (o.kind === 'add-method') return this.keyAddMethod(k);
    if (k === 'esc' || k === 'q') { this.overlay = null; return this.render(); }
    if (k === 'up' || k === 'k') { o.sel = (o.sel - 1 + o.targets.length) % o.targets.length; return this.render(); }
    if (k === 'down' || k === 'j') { o.sel = (o.sel + 1) % o.targets.length; return this.render(); }
    if (k === 'enter') {
      const target = o.targets[o.sel].name;
      copySessionTo(o.session, target, o.session.slug ?? slugForPath(this.cwd));
      this.overlay = null;
      return this.launch(target, ['--resume', o.session.id], { cwd: o.session.cwd });
    }
  }

  keyAddName(k, raw) {
    const o = this.overlay;
    if (k === 'esc') { this.overlay = null; return this.render(); }
    if (k === 'backspace') { o.value = o.value.slice(0, -1); o.error = null; return this.render(); }
    if (k === 'enter') {
      const options = [{ id: 'login', label: 'LOG IN TO A NEW ACCOUNT' }];
      if (hasDefaultLogin()) options.push({ id: 'import', label: 'USE THE CURRENT ~/.claude LOGIN (SESSIONS TOO)' });
      this.overlay = { kind: 'add-method', name: o.value, options, sel: 0 };
      return this.render();
    }
    if (raw && /^[A-Za-z0-9_-]$/.test(raw) && o.value.length < 32) {
      o.value += raw;
      o.error = null;
      return this.render();
    }
  }

  keyAddMethod(k) {
    const o = this.overlay;
    if (k === 'esc') {
      this.overlay = { kind: 'add-name', value: o.name, error: null };
      return this.render();
    }
    if (k === 'up' || k === 'k') { o.sel = (o.sel - 1 + o.options.length) % o.options.length; return this.render(); }
    if (k === 'down' || k === 'j') { o.sel = (o.sel + 1) % o.options.length; return this.render(); }
    if (k === 'enter') return this.executeAdd(o.name, o.options[o.sel].id);
  }

  executeAdd(name, method) {
    try {
      registerProfile(name);
    } catch (e) {
      this.overlay = { kind: 'add-name', value: name, error: e.message.toUpperCase() };
      return this.render();
    }
    this.overlay = null;
    prepareProfileDir(name);
    if (method === 'import') {
      importDefaultInto(name);
      const p = refreshIdentity(name);
      refreshWtIfInstalled();
      this.loadData();
      this.msg = `ADDED ${name.toUpperCase()}${p?.email ? ' · ' + p.email : ''}`;
      this.cascade = new Cascade();
      return this.render();
    }
    // fresh login: run Claude Code once so the user can /login, then read
    // the identity it wrote on the way out.
    this.launch(name);
    const p = refreshIdentity(name);
    refreshWtIfInstalled();
    this.loadData();
    this.msg = p?.email ? `ADDED ${name.toUpperCase()} · ${p.email}` : `NO LOGIN YET — BOARD ${name.toUpperCase()} AND RUN /login`;
    this.render();
  }

  tick() {
    const { w, h } = this.screen.size;
    if (this.cascade.active(w, h)) return this.render();
    const clk = this.clock();
    if (clk !== this.lastClock) { this.lastClock = clk; this.render(); }
  }

  render() {
    const { w, h } = this.screen.size;
    const state = {
      profiles: this.profiles, cache: this.cache, sel: this.sel, clock: this.clock(),
      msg: this.msg, spin: this.spin, rows: this.rows, total: this.sessions?.length,
      scrollTop: this.scrollTop, doctor: this.doctor,
      cwd: this.cwd, scope: this.scope, overlay: this.overlay,
    };
    const c = this.view === 'sessions' ? renderSessions(state, w, h)
      : this.view === 'doctor' ? renderDoctor(state, w, h)
      : renderBoard(state, w, h);
    if (this.overlay) drawOverlay(c, w, h, state);
    const now = Date.now();
    this.screen.frame(c.toAnsi(this.cascade.active(w, h, now) ? this.cascade.scrambler(now) : null));
  }
}

export function runTui() {
  return new App().run();
}

export { App }; // for headless state-transition tests
