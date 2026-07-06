import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.CCM_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-notify-'));
const { bucketFor, diffNotifications } = await import('../src/notify.js');
const { headroom, bestAlternative } = await import('../src/usage.js');

const win = (label, percent) => ({ label, percent, resetsAt: null, severity: 'normal', active: false });

test('bucketFor thresholds', () => {
  assert.equal(bucketFor(0), 0);
  assert.equal(bucketFor(79), 0);
  assert.equal(bucketFor(80), 1);
  assert.equal(bucketFor(94), 1);
  assert.equal(bucketFor(95), 2);
  assert.equal(bucketFor(100), 2);
});

test('diffNotifications fires on upward crossings only', () => {
  const prev = { work: { windows: [win('session (5h)', 70), win('week', 10)] } };
  const next = { work: { windows: [win('session (5h)', 85), win('week', 12)] } };
  const events = diffNotifications(prev, next);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'warn');
  assert.deepEqual(events[0].windows.map((w) => w.label), ['session (5h)']);
  // holding in the same bucket → silence
  assert.deepEqual(diffNotifications(next, next), []);
});

test('diffNotifications treats missing prev as bucket 0 and skips empty entries', () => {
  const events = diffNotifications({}, { work: { windows: [win('session (5h)', 96)] } });
  assert.equal(events[0].windows[0].bucket, 2);
  assert.deepEqual(diffNotifications({}, { broken: { error: 'timeout' } }), []);
});

test('diffNotifications reports quota reset as fresh', () => {
  const prev = { work: { windows: [win('session (5h)', 97)] } };
  const next = { work: { windows: [win('session (5h)', 2)] } };
  const events = diffNotifications(prev, next);
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, 'fresh');
});

test('headroom and bestAlternative pick the roomiest other profile', () => {
  const cache = {
    a: { windows: [win('s', 90), win('w', 40)] },
    b: { windows: [win('s', 20), win('w', 60)] },
    c: { windows: [] },
  };
  assert.equal(headroom(cache.a), 10);
  assert.equal(headroom(cache.b), 40);
  assert.equal(headroom(cache.c), null);
  assert.deepEqual(bestAlternative('a', ['a', 'b', 'c'], cache), { name: 'b', headroom: 40 });
  assert.equal(bestAlternative('b', ['b', 'c'], cache), null);
});
