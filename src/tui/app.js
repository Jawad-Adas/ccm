// ccm's face: a split-flap departure board for Claude Code accounts.
// Views: board (accounts) · departures (sessions for this folder) · doctor.

import { Screen, Canvas } from './term.js';
import { Cascade, WORDMARK, drawMeter, METER_TILES } from './flap.js';
import { INK, INK2, MUTED, AMBER, GOOD, CRITICAL, hueOf, meterColor } from './theme.js';
import { listProfiles } from '../registry.js';
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
    c.put(4, 9, 'ccm import <name>   adopt your current ~/.claude login', S.ink2);
    c.put(4, 10, 'ccm add <name>      log in to another account', S.ink2);
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
  drawKeybar(c, h - 1, [['↑↓', 'select'], ['enter', 'board'], ['s', 'departures'], ['r', 'refresh'], ['d', 'doctor'], ['q', 'quit']]);
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

function shortDir(dir, max = 26) {
  if (!dir) return '?';
  const short = dir.replace(/\\+$/, '').startsWith(os.homedir()) ? '~' + dir.slice(os.homedir().length) : dir;
  return short.length > max ? '…' + short.slice(-(max - 1)) : short;
}

export function renderSessions(state, w, h) {
  const c = new Canvas(w, h);
  const all = state.scope === 'all';
  c.put(2, 0, 'DEPARTURES', S.amberB);
  c.put(14, 0, all ? 'ALL FOLDERS' : state.cwd.toUpperCase(), S.muted);
  c.put(w - 2 - state.clock.length, 0, state.clock, S.amberB);
  c.put(2, 1, '─'.repeat(w - 4), S.seam);
  const list = state.sessions ?? [];
  if (!list.length) {
    c.put(4, 3, all ? 'NO SESSIONS ON ANY ACCOUNT' : 'NO SESSIONS FOR THIS FOLDER', S.inkB);
    c.put(4, 5, all ? 'Sessions appear here once you have worked with Claude Code.'
      : 'Press a to see every folder, or work with Claude Code here first.', S.ink2);
  }
  const dirW = all ? 26 : 0;
  let y = 3;
  for (const [i, s] of list.entries()) {
    if (y > h - 3) break;
    const selMark = i === state.sel;
    c.put(2, y, selMark ? '▌' : ' ', S.amberB);
    c.put(4, y, s.source.kind === 'profile' ? '●' : '○', s.source.kind === 'profile' ? { fg: hueOf(s.source.color) } : S.muted);
    c.put(6, y, timeAgo(new Date(s.mtime).toISOString()).padEnd(11), S.ink2);
    if (all) c.put(18, y, shortDir(s.cwd ?? s.slug, dirW - 1).padEnd(dirW), selMark ? S.ink2 : S.seam);
    c.put(18 + dirW, y, s.source.label.padEnd(11), S.muted);
    c.put(30 + dirW, y, s.id.slice(0, 8), selMark ? S.inkB : S.ink);
    c.put(40 + dirW, y, (s.title ?? '').slice(0, Math.max(0, w - 43 - dirW)), selMark ? S.ink2 : S.muted);
    y += 1;
  }
  c.put(2, h - 2, '─'.repeat(w - 4), S.seam);
  drawKeybar(c, h - 1, [['↑↓', 'select'], ['enter', 'resume'], ['m', 'transfer'], ['a', all ? 'this folder' : 'all folders'], ['esc', 'board']]);
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

function drawOverlay(c, w, h, state) {
  const ow = 44;
  const oh = state.overlay.targets.length + 4;
  const x0 = Math.max(1, ((w - ow) / 2) | 0);
  const y0 = Math.max(1, ((h - oh) / 2) | 0);
  for (let y = y0; y < y0 + oh; y++) c.put(x0, y, ' '.repeat(ow));
  c.put(x0, y0, '╭' + '─'.repeat(ow - 2) + '╮', S.amber);
  for (let y = y0 + 1; y < y0 + oh - 1; y++) {
    c.put(x0, y, '│', S.amber);
    c.put(x0 + ow - 1, y, '│', S.amber);
  }
  c.put(x0, y0 + oh - 1, '╰' + '─'.repeat(ow - 2) + '╯', S.amber);
  c.put(x0 + 2, y0 + 1, `TRANSFER ${state.overlay.session.id.slice(0, 8)} TO`, S.amberB);
  state.overlay.targets.forEach((t, i) => {
    const y = y0 + 2 + i;
    c.put(x0 + 2, y, i === state.overlay.sel ? '▌' : ' ', S.amberB);
    c.put(x0 + 4, y, '●', { fg: hueOf(t.color) });
    c.put(x0 + 6, y, t.name.toUpperCase(), i === state.overlay.sel ? S.inkB : S.ink);
  });
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
    this.lastClock = '';
  }

  clock() {
    return new Date().toTimeString().slice(0, 8);
  }

  run() {
    return new Promise((resolve) => {
      this.done = resolve;
      this.loadData();
      this.screen.onKey = (k) => { try { this.key(k); } catch { this.quit(1); } };
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
    this.sessions = allSessions(this.scope === 'all' ? null : slugForPath(this.cwd)).slice(0, 40)
      .map((s) => ({ ...s, ...sessionMeta(s.file) }));
    this.sel = 0;
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

  key(k) {
    if (k === 'ctrl-c') return this.quit(0);
    if (this.overlay) return this.keyOverlay(k);
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
    if (k === 'up' || k === 'k') return this.move(-1, this.sessions?.length ?? 0);
    if (k === 'down' || k === 'j') return this.move(1, this.sessions?.length ?? 0);
    if (k === 'a') {
      this.scope = this.scope === 'all' ? 'here' : 'all';
      this.loadSessions();
      this.cascade = new Cascade();
      return this.render();
    }
    const s = this.sessions?.[this.sel];
    if (!s) return;
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
    this.overlay = { session, targets, sel: 0 };
    this.render();
  }

  keyOverlay(k) {
    const o = this.overlay;
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
      msg: this.msg, spin: this.spin, sessions: this.sessions, doctor: this.doctor,
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
