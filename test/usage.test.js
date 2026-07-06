import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.CCM_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-usage-'));
const { parseWindows, isFresh, loadCache, saveCache } = await import('../src/usage.js');

// Shape captured live from the endpoint on 2026-07-06.
const LIVE_SAMPLE = {
  five_hour: { utilization: 43, resets_at: '2026-07-06T17:10:00+00:00' },
  seven_day: { utilization: 12, resets_at: '2026-07-10T10:00:00+00:00' },
  limits: [
    { kind: 'session', group: 'session', percent: 43, severity: 'normal', resets_at: '2026-07-06T17:10:00+00:00', scope: null, is_active: true },
    { kind: 'weekly_all', group: 'weekly', percent: 12, severity: 'normal', resets_at: '2026-07-10T10:00:00+00:00', scope: null, is_active: false },
    { kind: 'weekly_scoped', group: 'weekly', percent: 7, severity: 'normal', resets_at: '2026-07-10T10:00:00+00:00', scope: { model: { id: null, display_name: 'Fable' } }, is_active: false },
  ],
};

test('parseWindows prefers the limits array', () => {
  const w = parseWindows(LIVE_SAMPLE);
  assert.deepEqual(w.map((x) => x.label), ['session (5h)', 'week (all models)', 'week (Fable)']);
  assert.deepEqual(w.map((x) => x.percent), [43, 12, 7]);
  assert.equal(w[0].active, true);
  assert.equal(w[0].resetsAt, '2026-07-06T17:10:00+00:00');
});

test('parseWindows falls back to legacy fields and clamps', () => {
  const w = parseWindows({
    five_hour: { utilization: 150, resets_at: 'x' },
    seven_day: { utilization: -3, resets_at: 'y' },
    seven_day_opus: null,
  });
  assert.deepEqual(w.map((x) => [x.label, x.percent]), [['session (5h)', 100], ['week (all models)', 0]]);
});

test('parseWindows tolerates garbage', () => {
  assert.deepEqual(parseWindows(null), []);
  assert.deepEqual(parseWindows({}), []);
  assert.deepEqual(parseWindows({ limits: [{ kind: 'session' }] }), []);
});

test('isFresh honors TTL', () => {
  const now = 1_000_000;
  assert.ok(isFresh({ fetchedAt: now - 60_000 }, 300_000, now));
  assert.ok(!isFresh({ fetchedAt: now - 400_000 }, 300_000, now));
  assert.ok(!isFresh(null, 300_000, now));
  assert.ok(!isFresh({}, 300_000, now));
});

test('cache roundtrip', () => {
  assert.deepEqual(loadCache(), {});
  saveCache({ work: { fetchedAt: 1, windows: [] } });
  assert.deepEqual(loadCache(), { work: { fetchedAt: 1, windows: [] } });
});
