import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { deepMerge, setDotted, unsetDotted } from '../src/util.js';

process.env.CCM_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-compose-'));
const { mergeMcpServers } = await import('../src/compose.js');

test('deepMerge merges nested objects, replaces arrays and scalars', () => {
  assert.deepEqual(
    deepMerge(
      { model: 'sonnet', env: { A: '1', B: '2' }, list: [1, 2] },
      { model: 'opus', env: { B: '3', C: '4' }, list: [9] },
    ),
    { model: 'opus', env: { A: '1', B: '3', C: '4' }, list: [9] },
  );
  assert.deepEqual(deepMerge({ a: 1 }, {}), { a: 1 });
  assert.deepEqual(deepMerge(undefined, { a: 1 }), { a: 1 });
  assert.equal(deepMerge({ a: 1 }, undefined).a, 1);
  assert.deepEqual(deepMerge({ a: { b: 1 } }, { a: null }), { a: null });
});

test('setDotted / unsetDotted handle nested paths', () => {
  const o = {};
  setDotted(o, 'env.FOO', 'bar');
  setDotted(o, 'model', 'opus');
  assert.deepEqual(o, { env: { FOO: 'bar' }, model: 'opus' });
  unsetDotted(o, 'env.FOO');
  assert.deepEqual(o, { env: {}, model: 'opus' });
  unsetDotted(o, 'not.there');
  assert.deepEqual(o, { env: {}, model: 'opus' });
});

test('mergeMcpServers injects shared and records ownership', () => {
  const { next, record, warnings, changed } = mergeMcpServers(
    { mcpServers: { own: { command: 'x' } } },
    { shared1: { command: 'y' } },
    [],
  );
  assert.deepEqual(next.mcpServers, { own: { command: 'x' }, shared1: { command: 'y' } });
  assert.deepEqual(record, ['shared1']);
  assert.equal(warnings.length, 0);
  assert.ok(changed);
});

test('mergeMcpServers removes stale injections, keeps user servers', () => {
  const { next, record } = mergeMcpServers(
    { mcpServers: { own: { command: 'x' }, old: { command: 'gone' } } },
    {},
    ['old'],
  );
  assert.deepEqual(next.mcpServers, { own: { command: 'x' } });
  assert.deepEqual(record, []);
});

test('mergeMcpServers never clobbers a user-owned server with the same name', () => {
  const { next, record, warnings } = mergeMcpServers(
    { mcpServers: { db: { command: 'user-version' } } },
    { db: { command: 'shared-version' } },
    [],
  );
  assert.equal(next.mcpServers.db.command, 'user-version');
  assert.deepEqual(record, []);
  assert.equal(warnings.length, 1);
});

test('mergeMcpServers updates an injected server it owns and reports no change when identical', () => {
  const upd = mergeMcpServers({ mcpServers: { db: { command: 'v1' } } }, { db: { command: 'v2' } }, ['db']);
  assert.equal(upd.next.mcpServers.db.command, 'v2');
  assert.ok(upd.changed);
  const same = mergeMcpServers({ mcpServers: { db: { command: 'v2' } } }, { db: { command: 'v2' } }, ['db']);
  assert.ok(!same.changed);
});
