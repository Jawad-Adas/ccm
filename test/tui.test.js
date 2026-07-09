import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.CCM_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-tui-'));
process.env.NO_COLOR = '1';
const { Canvas } = await import('../src/tui/term.js');
const { Cascade, meterCells, drawMeter, METER_TILES } = await import('../src/tui/flap.js');
const { renderBoard, renderSessions, buildSessionRows, renderMcp } = await import('../src/tui/app.js');

test('Canvas puts text and clips at edges', () => {
  const c = new Canvas(10, 2);
  c.put(7, 0, 'ABCDE');
  c.put(0, 5, 'off-screen');
  assert.equal(c.toText().split('\n')[0], '       ABC');
});

test('meterCells rounds percent onto tiles', () => {
  assert.equal(meterCells(0), 0);
  assert.equal(meterCells(50), METER_TILES / 2);
  assert.equal(meterCells(100), METER_TILES);
  assert.equal(meterCells(null), 0);
});

test('drawMeter renders filled and empty tiles', () => {
  const c = new Canvas(40, 1);
  drawMeter(c, 0, 0, 50, { fg: '#fff' }, { fg: '#000' });
  const row = c.toText();
  assert.ok(row.includes('██'));
  assert.ok(row.includes('··'));
});

test('Cascade settles every cell after its sweep', () => {
  const now = Date.now();
  const cas = new Cascade(now);
  assert.ok(cas.active(80, 24, now));
  const later = now + 80 * 5 + 24 * 8 + 500;
  assert.ok(!cas.active(80, 24, later));
  assert.ok(cas.settled(79, 23, later));
});

test('renderBoard shows accounts, meters and keybar headlessly', () => {
  const state = {
    profiles: [
      { name: 'gasable', email: 'j@x.com', plan: 'team', color: 'cyan' },
      { name: 'personal', email: 'p@y.com', plan: 'max', color: 'magenta' },
    ],
    cache: {
      gasable: { windows: [
        { label: 'session (5h)', percent: 50, resetsAt: new Date(Date.now() + 3.6e6).toISOString() },
        { label: 'week (all models)', percent: 13, resetsAt: new Date(Date.now() + 8.64e7).toISOString() },
      ] },
    },
    sel: 0, clock: '12:00:00', msg: null, spin: false,
  };
  const text = renderBoard(state, 112, 30).toText();
  assert.match(text, /GASABLE/);
  assert.match(text, /PERSONAL/);
  assert.match(text, /C L A U D E {3}C O D E {3}A C C O U N T {3}B O A R D/);
  assert.match(text, /50%/);
  assert.match(text, /RESETS/);
  assert.match(text, /no usage data/);
  assert.match(text, /- remove/);
  assert.match(text, /doctor/);
});

test('renderBoard marks stale usage instead of asserting it live', () => {
  const old = Date.now() - 60 * 60_000; // 1h ago → past STALE_MS
  const state = {
    profiles: [{ name: 'gasable', email: 'j@x.com', plan: 'team', color: 'cyan' }],
    cache: {
      gasable: {
        fetchedAt: old, staleError: 'refresh-rejected',
        windows: [
          { label: 'session (5h)', percent: 100, resetsAt: new Date(Date.now() + 3.6e6).toISOString() },
          { label: 'week (all models)', percent: 19, resetsAt: new Date(Date.now() + 8.64e7).toISOString() },
        ],
      },
    },
    sel: 0, clock: '12:00:00', msg: null, spin: false,
  };
  const text = renderBoard(state, 110, 30).toText();
  assert.match(text, /STALE/);
  assert.doesNotMatch(text, /FULL/);        // never claims 100% is live
  assert.match(text, /as of .* ago/);
});

test('renderBoard empty state invites setup', () => {
  const text = renderBoard({ profiles: [], cache: {}, sel: 0, clock: '12:00:00' }, 90, 24).toText();
  assert.match(text, /NO ACCOUNTS ON THE BOARD/);
  assert.match(text, /add your first account/);
  assert.match(text, /a add/); // keybar
});

test('renderBoard flags a logged-out account with a chip and keeps the login key', () => {
  const state = {
    profiles: [{ name: 'gasable', email: 'j@x.com', plan: 'team', color: 'cyan', loggedOut: true }],
    cache: {}, sel: 0, clock: '12:00:00', msg: null, spin: false,
  };
  const text = renderBoard(state, 100, 30).toText();
  assert.match(text, /LOGGED OUT/);
  assert.match(text, /l login/); // keybar advertises the recovery key
});

test('App.launch refuses a logged-out account and prompts to sign in instead', async () => {
  const { App } = await import('../src/tui/app.js');
  const { registerProfile } = await import('../src/registry.js');
  const { profileDir } = await import('../src/paths.js');
  registerProfile('loout');
  fs.mkdirSync(profileDir('loout'), { recursive: true });
  fs.writeFileSync(path.join(profileDir('loout'), '.credentials.json'),
    JSON.stringify({ claudeAiOauth: { accessToken: '', refreshToken: '', expiresAt: 0 } }));

  const app = Object.create(App.prototype);
  app.msg = null;
  app.render = () => {};
  app.launch('loout');
  assert.match(app.msg, /LOGGED OUT/);
  assert.match(app.msg, /PRESS L/);
});

test('remove flow: confirm overlay → executeRemove deletes the profile from the board', async () => {
  const { App } = await import('../src/tui/app.js');
  const { registerProfile, listProfiles } = await import('../src/registry.js');
  const { profileDir } = await import('../src/paths.js');
  registerProfile('doomed');
  fs.mkdirSync(profileDir('doomed'), { recursive: true });

  const app = Object.create(App.prototype);
  app.overlay = null;
  app.msg = null;
  app.render = () => {};
  app.cascade = null;

  app.confirmRemove({ name: 'doomed', color: 'cyan', email: 'd@x.com' });
  assert.equal(app.overlay.kind, 'remove-confirm');
  assert.equal(app.overlay.name, 'doomed');
  // esc cancels without deleting
  app.keyRemove('esc');
  assert.equal(app.overlay, null);
  assert.ok(listProfiles().some((p) => p.name === 'doomed'));
  // confirm with y actually removes it
  app.confirmRemove({ name: 'doomed', color: 'cyan', email: 'd@x.com' });
  app.keyRemove('y');
  assert.equal(app.overlay, null);
  assert.match(app.msg, /REMOVED DOOMED/);
  assert.ok(!listProfiles().some((p) => p.name === 'doomed'));
  assert.ok(!fs.existsSync(profileDir('doomed')));
});

test('renderMcp lists servers with scope tags and shows copy confirmation', () => {
  const rows = [
    { type: 'account', name: 'gasable', color: 'cyan', count: 2 },
    { type: 'server', account: 'gasable', color: 'cyan', name: 'cloudflare', scope: 'user', project: null },
    { type: 'server', account: 'gasable', color: 'cyan', name: 'supabase-staging', scope: 'local', project: 'C:/proj/supplier' },
    { type: 'account', name: 'personal', color: 'magenta', count: 0 },
  ];
  const text = renderMcp({ mcpRows: rows, sel: 1, scrollTop: 0, clock: '12:00:00', msg: null }, 100, 24).toText();
  assert.match(text, /MCP SERVERS/);
  assert.match(text, /cloudflare/);
  assert.match(text, /user . everywhere/);
  assert.match(text, /supabase-staging/);
  assert.match(text, /local . supplier/);      // basename tag
  assert.match(text, /SHARED ONLY/);           // account with no own servers
  const withMsg = renderMcp({ mcpRows: rows, sel: 1, scrollTop: 0, clock: '12:00:00', msg: 'COPIED CLOUDFLARE → PERSONAL (USER)' }, 100, 24).toText();
  assert.match(withMsg, /COPIED CLOUDFLARE/);
});

test('MCP copy flow: server → target overlay → scope overlay → copyServer', async () => {
  const { App } = await import('../src/tui/app.js');
  const { registerProfile } = await import('../src/registry.js');
  const { listAccountServers } = await import('../src/mcp.js');
  const { profileDir } = await import('../src/paths.js');
  registerProfile('mfrom');
  registerProfile('mto');
  fs.mkdirSync(profileDir('mfrom'), { recursive: true });
  fs.mkdirSync(profileDir('mto'), { recursive: true });
  fs.writeFileSync(path.join(profileDir('mfrom'), '.claude.json'),
    JSON.stringify({ mcpServers: { cloudflare: { url: 'https://cf' } } }));

  const app = Object.create(App.prototype);
  app.view = 'mcp';
  app.cwd = 'C:/work/here';
  app.overlay = null;
  app.render = () => {};
  app.cascade = null;
  app.loadMcp();
  // land on the cloudflare server row and open the copy flow
  app.sel = app.mcpRows.findIndex((r) => r.type === 'server' && r.name === 'cloudflare');
  app.keyMcp('enter');
  assert.equal(app.overlay.kind, 'mcp-target');
  // choose target "mto"
  app.overlay.sel = app.overlay.targets.findIndex((t) => t.name === 'mto');
  app.keyMcpTarget('enter');
  assert.equal(app.overlay.kind, 'mcp-scope');
  // pick "user" scope (option 0) and confirm
  app.overlay.sel = 0;
  app.keyMcpScope('enter');
  assert.equal(app.overlay, null);
  assert.match(app.msg, /COPIED CLOUDFLARE/);
  assert.ok(listAccountServers('mto').some((s) => s.name === 'cloudflare' && s.scope === 'user'));
});

test('add-account overlay: name input → method choice → validation errors', async () => {
  const { App } = await import('../src/tui/app.js');
  const app = Object.create(App.prototype);
  app.overlay = null;
  app.msg = null;
  app.profiles = [];
  app.rendered = 0;
  app.render = () => { app.rendered++; };
  app.quit = () => {};
  app.move = () => {};
  app.refresh = () => {};

  app.keyBoard('a');
  assert.equal(app.overlay.kind, 'add-name');

  for (const ch of 'work-2') app.keyOverlay(ch, ch);
  assert.equal(app.overlay.value, 'work-2');
  app.keyOverlay('backspace', '\x7f');
  assert.equal(app.overlay.value, 'work-');
  app.keyOverlay('!', '!'); // rejected character
  assert.equal(app.overlay.value, 'work-');
  app.keyOverlay('2', '2');

  app.keyOverlay('enter', '\r');
  assert.equal(app.overlay.kind, 'add-method');
  assert.equal(app.overlay.name, 'work-2');
  assert.ok(app.overlay.options.length >= 1);
  assert.equal(app.overlay.options[0].id, 'login');

  // esc returns to the name step with the value kept
  app.keyOverlay('esc', '\x1b');
  assert.equal(app.overlay.kind, 'add-name');
  assert.equal(app.overlay.value, 'work-2');

  // a reserved name bounces back to the input with an error
  app.overlay.value = 'doctor';
  app.keyOverlay('enter', '\r');
  app.keyOverlay('enter', '\r'); // confirm method → registerProfile throws
  assert.equal(app.overlay.kind, 'add-name');
  assert.match(app.overlay.error, /CCM COMMAND/);
});

const SESSIONS = [
  { id: 'abcd1234-e5', mtime: Date.now() - 60000, title: 'fix the login bug', cwd: 'C:\\work\\api',
    slug: 'C--work-api', source: { kind: 'profile', label: 'gasable', color: 'cyan' } },
  { id: 'ffff0000-11', mtime: Date.now() - 7.2e6, title: null, cwd: 'C:\\other\\proj',
    slug: 'C--other-proj', source: { kind: 'default', label: 'default', color: null } },
];

test('renderSessions this-folder scope lists sessions flat, titles first', () => {
  const rows = buildSessionRows(SESSIONS, 'here');
  assert.deepEqual(rows.map((r) => r.type), ['session', 'session']);
  const text = renderSessions({ rows, sel: 0, clock: '12:00:00', cwd: 'C:\\x' }, 100, 24).toText();
  assert.match(text, /DEPARTURES/);
  assert.match(text, /fix the login bug/);
  assert.match(text, /abcd1234/);
  assert.match(text, /untitled/);
  assert.match(text, /transfer/);
  assert.match(text, /all folders/);
});

test('buildSessionRows all scope groups by folder, newest group open', () => {
  const rows = buildSessionRows(SESSIONS, 'all');
  assert.deepEqual(rows.map((r) => r.type), ['group', 'session', 'group']);
  assert.equal(rows[0].dir, 'C:\\work\\api');
  assert.equal(rows[0].open, true);
  assert.equal(rows[2].open, false);
  assert.equal(rows[2].count, 1);
  // explicit openDirs wins
  const all = buildSessionRows(SESSIONS, 'all', new Set(['C:\\work\\api', 'C:\\other\\proj']));
  assert.equal(all.filter((r) => r.type === 'session').length, 2);
});

test('renderSessions all-folders scope draws group headers and scroll state', () => {
  const rows = buildSessionRows(SESSIONS, 'all');
  const text = renderSessions({ rows, scope: 'all', total: 2, sel: 0, scrollTop: 0, clock: '12:00:00', cwd: 'C:\\x' }, 110, 24).toText();
  assert.match(text, /ALL FOLDERS · 2 SESSIONS/);
  assert.match(text, /▾ C:\\work\\api/);
  assert.match(text, /▸ C:\\other\\proj/);
  assert.match(text, /1 SESSION ·/);
  assert.match(text, /fix the login bug/);
  assert.doesNotMatch(text, /ffff0000/); // collapsed group hides its sessions
  assert.match(text, /resume \/ fold/);
});
