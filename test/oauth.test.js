import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.CCM_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-oauth-'));
const { refreshToken, validOauth, readOauth } = await import('../src/oauth.js');
const { profileDir } = await import('../src/paths.js');
const { registerProfile } = await import('../src/registry.js');

function writeCreds(name, oauth, extra = {}) {
  registerProfile(name);
  const dir = profileDir(name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.credentials.json'),
    JSON.stringify({ mcpOAuth: { keep: 'me' }, claudeAiOauth: oauth, ...extra }));
}

const realFetch = globalThis.fetch;
function stubFetch(handler) { globalThis.fetch = handler; }
function restore() { globalThis.fetch = realFetch; }

test('refreshToken persists rotated tokens and preserves the rest of the file', async () => {
  writeCreds('r1', { accessToken: 'old', refreshToken: 'refresh-1', expiresAt: 1 });
  stubFetch(async () => ({
    ok: true, status: 200,
    json: async () => ({ access_token: 'new-access', refresh_token: 'refresh-2', expires_in: 3600, scope: 'a b' }),
  }));
  try {
    const res = await refreshToken('r1');
    assert.equal(res.accessToken, 'new-access');
    assert.equal(res.refreshToken, 'refresh-2');
    assert.ok(res.expiresAt > Date.now());
    // persisted to disk, rotation saved, other keys intact
    const onDisk = JSON.parse(fs.readFileSync(path.join(profileDir('r1'), '.credentials.json'), 'utf8'));
    assert.equal(onDisk.claudeAiOauth.refreshToken, 'refresh-2');
    assert.equal(onDisk.mcpOAuth.keep, 'me');
    assert.deepEqual(readOauth('r1').scopes, ['a', 'b']);
  } finally { restore(); }
});

test('refreshToken keeps the old refresh token when the server omits a new one', async () => {
  writeCreds('r2', { accessToken: 'old', refreshToken: 'keep-this', expiresAt: 1 });
  stubFetch(async () => ({ ok: true, status: 200, json: async () => ({ access_token: 'a', expires_in: 3600 }) }));
  try {
    const res = await refreshToken('r2');
    assert.equal(res.refreshToken, 'keep-this');
  } finally { restore(); }
});

test('refreshToken reports rejection without corrupting credentials', async () => {
  writeCreds('r3', { accessToken: 'old', refreshToken: 'dead', expiresAt: 1 });
  stubFetch(async () => ({ ok: false, status: 400, json: async () => ({ error: 'invalid_grant' }) }));
  try {
    assert.deepEqual(await refreshToken('r3'), { error: 'refresh-rejected' });
    assert.equal(readOauth('r3').refreshToken, 'dead'); // untouched
  } finally { restore(); }
});

test('validOauth refreshes an expired token and returns the valid one', async () => {
  writeCreds('v1', { accessToken: 'old', refreshToken: 'r', expiresAt: Date.now() - 1000 });
  stubFetch(async () => ({ ok: true, status: 200, json: async () => ({ access_token: 'fresh', refresh_token: 'r2', expires_in: 3600 }) }));
  try {
    const res = await validOauth('v1');
    assert.equal(res.oauth.accessToken, 'fresh');
  } finally { restore(); }
});

test('validOauth passes through a still-valid token without a network call', async () => {
  writeCreds('v2', { accessToken: 'good', refreshToken: 'r', expiresAt: Date.now() + 3_600_000 });
  stubFetch(async () => { throw new Error('should not fetch'); });
  try {
    const res = await validOauth('v2');
    assert.equal(res.oauth.accessToken, 'good');
  } finally { restore(); }
});

test('validOauth surfaces token-expired when there is no refresh token', async () => {
  writeCreds('v3', { accessToken: 'old', expiresAt: Date.now() - 1000 });
  assert.deepEqual(await validOauth('v3'), { error: 'token-expired' });
});
