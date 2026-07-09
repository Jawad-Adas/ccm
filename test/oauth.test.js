import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.CCM_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-oauth-'));
process.env.CCM_CLAUDE_DIR = path.join(process.env.CCM_HOME, 'fake-claude');
const { refreshToken, validOauth, resolveToken, readOauth, authState, sameAccountValidSource } = await import('../src/oauth.js');
const { profileDir } = await import('../src/paths.js');
const { registerProfile } = await import('../src/registry.js');

function writeCreds(name, oauth, { accountUuid = null } = {}) {
  registerProfile(name);
  const dir = profileDir(name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.credentials.json'),
    JSON.stringify({ mcpOAuth: { keep: 'me' }, claudeAiOauth: oauth }));
  if (accountUuid) fs.writeFileSync(path.join(dir, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid } }));
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

test('resolveToken borrows a valid token from another source on the same account', async () => {
  // dead profile: expired, no refresh token → its own token is unrecoverable
  writeCreds('dead', { accessToken: 'x', expiresAt: Date.now() - 1000 }, { accountUuid: 'acct-shared' });
  // sibling logged into the SAME account with a live token
  writeCreds('alive', { accessToken: 'live-token', expiresAt: Date.now() + 3_600_000 }, { accountUuid: 'acct-shared' });
  const res = await resolveToken('dead');
  assert.equal(res.accessToken, 'live-token');
  assert.equal(res.borrowedFrom, 'alive');
});

test('resolveToken does not borrow across different accounts', async () => {
  writeCreds('dead2', { accessToken: 'x', expiresAt: Date.now() - 1000 }, { accountUuid: 'acct-A' });
  writeCreds('other', { accessToken: 'nope', expiresAt: Date.now() + 3_600_000 }, { accountUuid: 'acct-B' });
  assert.deepEqual(await resolveToken('dead2'), { error: 'token-expired' });
});

test('authState flags a wiped/empty token as logged-out', () => {
  // the exact shape Claude Code writes when it clears creds on a failed refresh
  writeCreds('wiped', { accessToken: '', refreshToken: '', expiresAt: 0 });
  assert.equal(authState('wiped'), 'logged-out');
});

test('authState is logged-out when credentials are missing entirely', () => {
  registerProfile('nocreds');
  fs.mkdirSync(profileDir('nocreds'), { recursive: true });
  assert.equal(authState('nocreds'), 'logged-out');
});

test('authState is ok for a valid token, and for an expired one that can still refresh', () => {
  writeCreds('valid', { accessToken: 'good', refreshToken: 'r', expiresAt: Date.now() + 3_600_000 });
  assert.equal(authState('valid'), 'ok');
  // expired but has a refresh token → Claude Code refreshes on launch, still ok
  writeCreds('refreshable', { accessToken: 'old', refreshToken: 'r', expiresAt: Date.now() - 1000 });
  assert.equal(authState('refreshable'), 'ok');
});

test('authState is logged-out when the token is expired and there is no refresh token', () => {
  writeCreds('stuck', { accessToken: 'old', expiresAt: Date.now() - 1000 });
  assert.equal(authState('stuck'), 'logged-out');
});

test('sameAccountValidSource names another live login on the same account (the rotation culprit)', () => {
  writeCreds('out', { accessToken: '', refreshToken: '', expiresAt: 0 }, { accountUuid: 'acct-Z' });
  writeCreds('still-in', { accessToken: 'live', expiresAt: Date.now() + 3_600_000 }, { accountUuid: 'acct-Z' });
  assert.equal(sameAccountValidSource('out'), 'still-in');
});

test('sameAccountValidSource returns null when no other source shares the account', () => {
  writeCreds('lonely', { accessToken: '', refreshToken: '', expiresAt: 0 }, { accountUuid: 'acct-solo' });
  writeCreds('unrelated', { accessToken: 'live', expiresAt: Date.now() + 3_600_000 }, { accountUuid: 'acct-different' });
  assert.equal(sameAccountValidSource('lonely'), null);
});
