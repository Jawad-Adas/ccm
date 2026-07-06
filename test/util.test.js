import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bar, timeUntil, timeAgo } from '../src/util.js';

test('bar fills proportionally and clamps', () => {
  assert.equal(bar(0, 10), '░░░░░░░░░░');
  assert.equal(bar(50, 10), '█████░░░░░');
  assert.equal(bar(100, 10), '██████████');
  assert.equal(bar(250, 10), '██████████');
  assert.equal(bar(-5, 10), '░░░░░░░░░░');
  assert.equal(bar(null, 4), '░░░░');
});

test('timeUntil formats future durations', () => {
  const now = Date.parse('2026-07-06T12:00:00Z');
  assert.equal(timeUntil('2026-07-06T12:45:00Z', now), '45m');
  assert.equal(timeUntil('2026-07-06T14:05:00Z', now), '2h 05m');
  assert.equal(timeUntil('2026-07-09T16:00:00Z', now), '3d 4h');
  assert.equal(timeUntil('2026-07-06T11:00:00Z', now), 'now');
  assert.equal(timeUntil(null, now), '?');
  assert.equal(timeUntil('garbage', now), '?');
});

test('timeAgo formats past durations', () => {
  const now = Date.parse('2026-07-06T12:00:00Z');
  assert.equal(timeAgo('2026-07-06T11:59:40Z', now), 'just now');
  assert.equal(timeAgo('2026-07-06T11:30:00Z', now), '30m ago');
  assert.equal(timeAgo('2026-07-06T08:00:00Z', now), '4h ago');
  assert.equal(timeAgo('2026-07-01T12:00:00Z', now), '5d ago');
  assert.equal(timeAgo(null, now), '—');
});
