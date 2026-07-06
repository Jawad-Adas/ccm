#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { profileDir, DEFAULT_CLAUDE_DIR, HOME_CLAUDE_JSON } from '../src/paths.js';
import { colorize, bold, dim, timeAgo, readJson } from '../src/util.js';
import {
  listProfiles, getProfile, registerProfile, unregisterProfile,
  refreshIdentity, validName,
} from '../src/registry.js';
import { ensureShared, linkIntoProfile, syncFilesIntoProfile, unlinkShared } from '../src/shared.js';
import { launchProfile, isRunning } from '../src/launch.js';
import { findPin, writePin, removePin, PIN_FILE } from '../src/pin.js';
import { gatherStatus, renderStatus } from '../src/status.js';
import { refreshAll } from '../src/usage.js';
import { statuslineMain, installStatusline } from '../src/statusline.js';
import { pickProfile } from '../src/picker.js';

const VERSION = readJson(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), {}).version ?? '?';

function fail(msg) {
  console.error(colorize('red', `error: ${msg}`));
  process.exit(1);
}

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a.trim()); }));
}

function setupProfileDir(name) {
  const dir = profileDir(name);
  fs.mkdirSync(dir, { recursive: true });
  ensureShared();
  for (const w of linkIntoProfile(dir)) console.error(colorize('yellow', `warn: ${w}`));
  syncFilesIntoProfile(dir);
  return dir;
}

async function defaultAction() {
  const profiles = listProfiles();
  if (!profiles.length) {
    console.log(renderNoProfiles());
    return 0;
  }
  const pin = findPin();
  if (pin) {
    if (!getProfile(pin.name)) fail(`${pin.file} pins unknown profile "${pin.name}"`);
    console.log(dim(`pinned → ${pin.name} (${pin.file})`));
    return launchProfile(pin.name, []);
  }
  return pickAndLaunch(profiles);
}

async function pickAndLaunch(profiles) {
  if (!process.stdin.isTTY) {
    console.log(renderList(profiles));
    console.log(dim('\n(non-interactive terminal — run "ccm <name>" to launch)'));
    return 0;
  }
  const byLastUsed = [...profiles].sort((a, b) => (b.lastUsed ?? '').localeCompare(a.lastUsed ?? ''));
  const name = await pickProfile(profiles, { preselect: byLastUsed[0]?.name });
  if (!name) return 0;
  return launchProfile(name, []);
}

function renderNoProfiles() {
  return [
    'No profiles yet. Get started:',
    `  ${bold('ccm import work')}     adopt your current ~/.claude login as profile "work"`,
    `  ${bold('ccm add personal')}    create a profile and log in to another account`,
  ].join('\n');
}

function renderList(profiles) {
  if (!profiles.length) return renderNoProfiles();
  const pin = findPin();
  return profiles.map((p) => [
    ' ',
    colorize(p.color, '●'),
    bold(p.name.padEnd(14)),
    (p.email ?? '(email unknown)').padEnd(30),
    dim((p.plan ?? '').padEnd(8)),
    isRunning(p.name) ? colorize('green', 'RUNNING  ') : dim(`${timeAgo(p.lastUsed).padEnd(9)}`),
    pin?.name === p.name ? colorize('cyan', `pinned here`) : '',
  ].join(' ')).join('\n');
}

async function addCmd(args) {
  const name = args[0];
  if (!name) fail('usage: ccm add <name>');
  if (!validName(name)) fail(`invalid name "${name}" (letters, digits, - and _ only)`);
  if (getProfile(name)) fail(`profile "${name}" already exists`);
  registerProfile(name);
  setupProfileDir(name);
  console.log(`Profile ${bold(name)} created.`);
  console.log('Launching Claude Code for its first login — sign in to the account you want,');
  console.log(`then exit (${dim('/exit')}) to finish registration.\n`);
  const code = launchProfile(name, []);
  const p = refreshIdentity(name);
  if (p?.email) console.log(`\n${colorize('green', '✔')} ${bold(name)} registered as ${bold(p.email)} (${p.plan ?? 'unknown plan'})`);
  else console.log(`\n${colorize('yellow', '!')} No login detected yet — launch it later with ${bold(`ccm ${name}`)} and run /login.`);
  return code;
}

async function importCmd(args) {
  const name = args[0] ?? 'main';
  if (!validName(name)) fail(`invalid name "${name}"`);
  if (getProfile(name)) fail(`profile "${name}" already exists`);
  const srcCreds = path.join(DEFAULT_CLAUDE_DIR, '.credentials.json');
  if (!fs.existsSync(srcCreds)) fail(`no login found at ${srcCreds} — run claude once and log in first`);
  registerProfile(name);
  const dir = setupProfileDir(name);
  fs.copyFileSync(srcCreds, path.join(dir, '.credentials.json'));
  if (fs.existsSync(HOME_CLAUDE_JSON)) fs.copyFileSync(HOME_CLAUDE_JSON, path.join(dir, '.claude.json'));
  const p = refreshIdentity(name);
  console.log(`${colorize('green', '✔')} Imported current login as ${bold(name)}` + (p?.email ? ` (${p.email}, ${p.plan ?? '?'})` : ''));
  console.log(dim('Your ~/.claude and the plain "claude" command are untouched.'));
  return 0;
}

async function removeCmd(args) {
  const name = args.find((a) => !a.startsWith('-'));
  const yes = args.includes('--yes') || args.includes('-y');
  if (!name) fail('usage: ccm remove <name> [--yes]');
  if (!getProfile(name)) fail(`unknown profile "${name}"`);
  if (isRunning(name)) fail(`profile "${name}" has a running session — close it first`);
  if (!yes) {
    const a = await ask(`Delete profile "${name}" and its credentials/history? [y/N] `);
    if (!/^y(es)?$/i.test(a)) { console.log('aborted'); return 0; }
  }
  const dir = profileDir(name);
  unlinkShared(dir);
  fs.rmSync(dir, { recursive: true, force: true });
  unregisterProfile(name);
  console.log(`${colorize('green', '✔')} removed ${bold(name)}`);
  return 0;
}

async function statusCmd(args) {
  const rows = await gatherStatus({ maxAgeMs: args.includes('--fresh') ? 0 : undefined });
  if (args.includes('--json')) {
    console.log(JSON.stringify(rows, null, 2));
    return 0;
  }
  console.log(renderStatus(rows));
  return 0;
}

function pinCmd(args) {
  const name = args[0];
  if (!name) {
    const pin = findPin();
    console.log(pin ? `pinned: ${bold(pin.name)} (${pin.file})` : 'no pin in effect here');
    return 0;
  }
  if (!getProfile(name)) fail(`unknown profile "${name}" — run: ccm list`);
  const file = writePin(name);
  console.log(`${colorize('green', '✔')} ${file} — "ccm" in this folder (and below) now launches ${bold(name)}`);
  return 0;
}

function unpinCmd() {
  const file = removePin();
  console.log(file ? `${colorize('green', '✔')} removed ${file}` : `no ${PIN_FILE} in this folder`);
  return 0;
}

function help() {
  console.log(`${bold('ccm')} v${VERSION} — Claude Code account manager

${bold('Usage')}
  ccm                     pinned account here? launch it — otherwise interactive picker
  ccm <name> [args…]      launch Claude Code on that account (args pass through, e.g. --resume)
  ccm pick                force the interactive picker (ignores pin)

${bold('Accounts')}
  ccm import [name]       adopt your current ~/.claude login as a profile (default: main)
  ccm add <name>          create a profile and log in to another account
  ccm list                all profiles at a glance
  ccm remove <name>       delete a profile (asks first; --yes to skip)

${bold('Insight')}
  ccm status [--fresh]    quota dashboard for every account (--json for raw data)
  ccm statusline install  show active account + quota inside Claude Code's statusline

${bold('Pinning')}
  ccm pin <name>          this folder (and below) always uses that account
  ccm unpin               remove the pin in this folder

Profiles live in ~/.ccm/profiles/<name> — each is an isolated CLAUDE_CONFIG_DIR,
so different accounts can run at the same time in different terminals.
Shared config (settings.json, agents, skills, commands, hooks, CLAUDE.md) is
managed once in ~/.ccm/shared and linked/synced into every profile.`);
  return 0;
}

const [cmd, ...rest] = process.argv.slice(2);
let exitCode = 0;
try {
  switch (cmd) {
    case undefined: exitCode = await defaultAction(); break;
    case 'pick': exitCode = await pickAndLaunch(listProfiles()); break;
    case 'add': exitCode = await addCmd(rest); break;
    case 'import': exitCode = await importCmd(rest); break;
    case 'list': case 'ls': console.log(renderList(listProfiles())); break;
    case 'remove': case 'rm': exitCode = await removeCmd(rest); break;
    case 'status': case 'st': exitCode = await statusCmd(rest); break;
    case 'refresh': await refreshAll(listProfiles().map((p) => p.name)); break;
    case 'pin': exitCode = pinCmd(rest); break;
    case 'unpin': exitCode = unpinCmd(); break;
    case 'statusline':
      if (rest[0] === 'install') {
        const file = installStatusline();
        console.log(`${colorize('green', '✔')} statusline set in ${file}`);
        console.log(dim('Applies to every profile on its next ccm launch. (Your default ~/.claude is untouched.)'));
      } else await statuslineMain();
      break;
    case 'help': case '--help': case '-h': exitCode = help(); break;
    case 'version': case '--version': case '-v': console.log(VERSION); break;
    default:
      if (getProfile(cmd)) exitCode = launchProfile(cmd, rest);
      else {
        const names = listProfiles().map((p) => p.name);
        fail(`unknown command or profile "${cmd}"${names.length ? ` — profiles: ${names.join(', ')}` : ''} (see: ccm help)`);
      }
  }
} catch (e) {
  fail(e.message);
}
// Set exitCode instead of process.exit(): force-exiting while fetch's network
// handles are still closing intermittently trips a libuv assertion on Windows.
process.exitCode = exitCode;
