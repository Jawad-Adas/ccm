import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.CCM_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-tui-'));
process.env.NO_COLOR = '1';
const { Canvas } = await import('../src/tui/term.js');
const { Cascade, meterCells, drawMeter, METER_TILES } = await import('../src/tui/flap.js');
const { renderBoard, renderSessions } = await import('../src/tui/app.js');

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
  const text = renderBoard(state, 100, 30).toText();
  assert.match(text, /GASABLE/);
  assert.match(text, /PERSONAL/);
  assert.match(text, /C L A U D E {3}C O D E {3}A C C O U N T {3}B O A R D/);
  assert.match(text, /50%/);
  assert.match(text, /RESETS/);
  assert.match(text, /no usage data/);
  assert.match(text, /doctor/);
});

test('renderBoard empty state invites setup', () => {
  const text = renderBoard({ profiles: [], cache: {}, sel: 0, clock: '12:00:00' }, 90, 24).toText();
  assert.match(text, /NO ACCOUNTS ON THE BOARD/);
  assert.match(text, /ccm import/);
});

test('renderSessions lists transcripts with sources', () => {
  const state = {
    sessions: [
      { id: 'abcd1234-e5', mtime: Date.now() - 60000, title: 'fix the login bug', source: { kind: 'profile', label: 'gasable', color: 'cyan' } },
      { id: 'ffff0000-11', mtime: Date.now() - 7.2e6, title: null, source: { kind: 'default', label: 'default', color: null } },
    ],
    sel: 0, clock: '12:00:00', cwd: 'C:\\x',
  };
  const text = renderSessions(state, 100, 24).toText();
  assert.match(text, /DEPARTURES/);
  assert.match(text, /abcd1234/);
  assert.match(text, /fix the login bug/);
  assert.match(text, /transfer/);
  assert.match(text, /all folders/);
});

test('renderSessions all-folders scope shows the directory column', () => {
  const state = {
    scope: 'all',
    sessions: [
      { id: 'abcd1234-e5', mtime: Date.now() - 60000, title: 'ship the board', cwd: 'C:\\work\\api',
        slug: 'C--work-api', source: { kind: 'profile', label: 'gasable', color: 'cyan' } },
    ],
    sel: 0, clock: '12:00:00', cwd: 'C:\\elsewhere',
  };
  const text = renderSessions(state, 110, 24).toText();
  assert.match(text, /ALL FOLDERS/);
  assert.match(text, /C:\\work\\api/);
  assert.match(text, /this folder/);
});
