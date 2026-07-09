import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.CCM_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'ccm-launch-'));
process.env.CCM_CLAUDE_DIR = path.join(process.env.CCM_HOME, 'fake-claude');
const { launchProfile, LOGGED_OUT_EXIT } = await import('../src/launch.js');
const { profileDir } = await import('../src/paths.js');
const { registerProfile } = await import('../src/registry.js');

function writeCreds(name, oauth) {
  registerProfile(name);
  const dir = profileDir(name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '.credentials.json'), JSON.stringify({ claudeAiOauth: oauth }));
  return dir;
}

// Silence the guidance the preflight prints so the test output stays clean.
function quiet(fn) {
  const orig = console.error;
  console.error = () => {};
  try { return fn(); } finally { console.error = orig; }
}

test('launchProfile refuses to start a logged-out account (no dead-end at Claude login)', () => {
  const dir = writeCreds('wiped', { accessToken: '', refreshToken: '', expiresAt: 0 });
  const code = quiet(() => launchProfile('wiped'));
  assert.equal(code, LOGGED_OUT_EXIT);
  // it bailed before doing any launch work — no lock, lastUsed untouched
  assert.ok(!fs.existsSync(path.join(dir, 'ccm.lock')), 'must not write a lock for a blocked launch');
});

test('launchProfile does not block when intent is login (that path wants the sign-in screen)', () => {
  writeCreds('relogin', { accessToken: '', refreshToken: '', expiresAt: 0 });
  // With intent:'login' the preflight is skipped; it proceeds to spawn `claude`
  // (absent in the test env → non-zero), but crucially it is NOT the block code.
  const code = quiet(() => launchProfile('relogin', [], { intent: 'login' }));
  assert.notEqual(code, LOGGED_OUT_EXIT);
});

test('launchProfile throws for an unknown profile', () => {
  assert.throws(() => launchProfile('ghost'), /unknown profile/);
});
