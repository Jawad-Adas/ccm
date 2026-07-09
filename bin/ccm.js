#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import {
  profileDir, DEFAULT_CLAUDE_DIR,
  overrideSettingsPath, overrideClaudeMdPath,
} from '../src/paths.js';
import { colorize, bold, dim, timeAgo, readJson, writeJson, setDotted, unsetDotted } from '../src/util.js';
import {
  listProfiles, getProfile, registerProfile,
  refreshIdentity, validName, updateProfile,
} from '../src/registry.js';
import { prepareProfileDir, hasDefaultLogin, importDefaultInto, removeProfile } from '../src/profiles.js';
import { launchProfile, isRunning } from '../src/launch.js';
import { findPin, writePin, removePin, PIN_FILE } from '../src/pin.js';
import { gatherStatus, renderStatus } from '../src/status.js';
import { refreshAll, loadCache, bestAlternative } from '../src/usage.js';
import { statuslineMain, installStatusline } from '../src/statusline.js';
import { runTui } from '../src/tui/app.js';
import { startUi } from '../src/ui/server.js';
import { slugForPath, findSession, copySessionTo } from '../src/sessions.js';
import { diffNotifications, notificationsEnabled, setNotificationsEnabled, sendToast } from '../src/notify.js';
import { installWt, uninstallWt, wtDetected, wtInstalled, wtInSync, refreshWtIfInstalled } from '../src/wt.js';
import { runDoctor } from '../src/doctor.js';
import { mcpList, mcpShare, mcpUnshare, parseMcpCopy, resolveCopyTarget, copyServer } from '../src/mcp.js';

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
  for (const w of prepareProfileDir(name)) console.error(colorize('yellow', `warn: ${w}`));
  return profileDir(name);
}

function uiCmd(args) {
  const portIdx = args.indexOf('--port');
  startUi({
    port: portIdx > -1 ? Number(args[portIdx + 1]) || 7788 : 7788,
    open: !args.includes('--no-open'),
  });
  return 0;
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
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log(renderList(profiles));
    console.log(dim('\n(non-interactive terminal — run "ccm <name>" to launch)'));
    return 0;
  }
  return runTui();
}

async function moveSessionCmd(args) {
  const positional = args.filter((a) => !a.startsWith('--'));
  const to = positional[0];
  const id = positional[1] ?? null;
  const noLaunch = args.includes('--no-launch');
  if (!to) fail('usage: ccm move-session <to-profile> [session-id] [--no-launch]');
  if (!getProfile(to)) fail(`unknown profile "${to}" — run: ccm list`);
  const slug = slugForPath(process.cwd());
  const found = findSession(slug, id, to);
  if (!found) {
    fail(`no session found for this folder${id ? ` with id ${id}` : ''} — run this from the project folder you were working in`);
  }
  const { artifacts } = copySessionTo(found, to, slug);
  console.log(`${colorize('green', '✔')} session ${bold(found.id.slice(0, 8))} (${timeAgo(new Date(found.mtime).toISOString())}, from ${found.source.label}) → ${bold(to)}${artifacts ? dim(`  +${artifacts} artifact(s)`) : ''}`);
  console.log(dim('The original stays on the source account.'));
  if (!noLaunch && process.stdin.isTTY) {
    console.log(dim(`launching: ccm ${to} --resume ${found.id.slice(0, 8)}…`));
    return launchProfile(to, ['--resume', found.id]);
  }
  console.log(`continue with: ${bold(`ccm ${to} --resume ${found.id}`)}`);
  return 0;
}

function overrideCmd(args) {
  const name = args[0];
  if (!name || name.startsWith('--')) fail('usage: ccm override <profile> [key=value ...] [--unset key] [--clear]');
  if (!getProfile(name)) fail(`unknown profile "${name}" — run: ccm list`);
  const file = overrideSettingsPath(name);
  const rest = args.slice(1);
  if (!rest.length) {
    const cur = readJson(file, null);
    console.log(`${bold(name)} settings override ${dim(`(${file})`)}`);
    console.log(cur ? JSON.stringify(cur, null, 2) : dim('  (none — set with: ccm override ' + name + ' key=value)'));
    const md = overrideClaudeMdPath(name);
    console.log(`CLAUDE.md fragment ${dim(`(${md})`)}: ${fs.existsSync(md) ? colorize('green', 'present — appended to shared CLAUDE.md') : dim('none — create the file to add profile-specific memory')}`);
    const mem = getProfile(name).memory === 'private' ? colorize('yellow', 'private — this account keeps its own') : colorize('green', 'shared — pooled across accounts per project');
    console.log(`auto-memory: ${mem}`);
    return 0;
  }
  let cfg = readJson(file, {}) ?? {};
  if (rest.includes('--clear')) cfg = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--clear') continue;
    if (a === '--unset') {
      const key = rest[++i];
      if (!key) fail('--unset needs a key');
      unsetDotted(cfg, key);
      continue;
    }
    const eq = a.indexOf('=');
    if (eq < 1) fail(`expected key=value, got "${a}"`);
    const key = a.slice(0, eq);
    const raw = a.slice(eq + 1);
    if (key === 'memory') {
      // ccm's own knob, stored in the registry — not a Claude Code setting
      if (raw !== 'shared' && raw !== 'private') fail('memory must be "shared" or "private"');
      updateProfile(name, { memory: raw });
      console.log(`${colorize('green', '✔')} auto-memory for ${bold(name)}: ${raw} ${dim('(applies on next launch)')}`);
      continue;
    }
    let value;
    try { value = JSON.parse(raw); } catch { value = raw; }
    setDotted(cfg, key, value);
  }
  writeJson(file, cfg);
  console.log(`${colorize('green', '✔')} ${file}`);
  console.log(dim(`Applied on the next launch of ${name} (merged over shared settings).`));
  return 0;
}

async function refreshCmd() {
  const prev = loadCache();
  await refreshAll(listProfiles().map((p) => p.name));
  if (!notificationsEnabled()) return 0;
  const events = diffNotifications(prev, loadCache()).slice(0, 3);
  for (const ev of events) {
    const profile = getProfile(ev.profile);
    if (ev.kind === 'fresh') {
      sendToast(`Claude — ${ev.profile}`, 'Quota reset — this account is fresh again.');
      continue;
    }
    const lines = ev.windows.map((w) => `${w.label}: ${w.percent}%`).join(', ');
    let tip = '';
    if (ev.windows.some((w) => w.bucket === 2)) {
      const alt = bestAlternative(ev.profile, listProfiles().map((p) => p.name));
      if (alt && alt.headroom >= 30) tip = ` — continue elsewhere: ccm move-session ${alt.name}`;
    }
    sendToast(`Claude — ${ev.profile}${profile?.email ? ` (${profile.email})` : ''}`, `${lines}${tip}`);
  }
  return 0;
}

function notifyCmd(args) {
  const sub = args[0] ?? 'status';
  if (sub === 'on' || sub === 'off') {
    setNotificationsEnabled(sub === 'on');
    console.log(`${colorize('green', '✔')} quota notifications ${sub}`);
  } else if (sub === 'test') {
    sendToast('ccm — test', 'Notifications are working. You would see quota warnings like: session (5h): 95%');
    console.log('test toast sent');
  } else {
    console.log(`quota notifications: ${notificationsEnabled() ? colorize('green', 'on') : colorize('yellow', 'off')} ${dim('(ccm notify on|off|test)')}`);
    console.log(dim('Fires on crossing 80% and 95%, and when a limit resets. Checks run whenever usage is refreshed (statusline keeps this fresh while sessions are open).'));
  }
  return 0;
}

function wtCmd(args) {
  const sub = args[0] ?? 'status';
  if (sub === 'install') {
    if (!wtDetected()) console.log(colorize('yellow', 'warn: Windows Terminal not detected — writing the fragment anyway'));
    const file = installWt();
    console.log(`${colorize('green', '✔')} ${file}`);
    console.log(dim('Profiles appear in Windows Terminal\'s dropdown after you restart it. Kept in sync automatically on ccm add/remove.'));
  } else if (sub === 'uninstall') {
    console.log(uninstallWt() ? `${colorize('green', '✔')} fragment removed` : 'nothing installed');
  } else {
    console.log(!wtInstalled() ? 'not installed — run: ccm wt install'
      : wtInSync() ? colorize('green', 'installed and in sync')
      : colorize('yellow', 'installed but out of date — run: ccm wt install'));
  }
  return 0;
}

async function mcpCmd(args) {
  const sub = args[0];
  if (sub === 'list' || !sub) {
    console.log(mcpList());
    return 0;
  }
  if (sub === 'share') {
    const name = args[1];
    if (!name) fail('usage: ccm mcp share <server-name> [--from <profile>]');
    const fromIdx = args.indexOf('--from');
    const res = mcpShare(name, fromIdx > -1 ? args[fromIdx + 1] : null);
    if (res.error) fail(res.error);
    console.log(`${colorize('green', '✔')} "${name}" (from ${res.from}) is now shared — injected into every profile on its next launch`);
    return 0;
  }
  if (sub === 'unshare') {
    const name = args[1];
    if (!name) fail('usage: ccm mcp unshare <server-name>');
    const res = mcpUnshare(name);
    if (res.error) fail(res.error);
    console.log(`${colorize('green', '✔')} "${name}" unshared — removed from profiles on their next launch`);
    return 0;
  }
  if (sub === 'copy') {
    const o = parseMcpCopy(args.slice(1));
    if (!o.name || !o.from || !o.to) {
      fail('usage: ccm mcp copy <server> --from <profile> --to <profile> [--scope user|local] [--project <path>]');
    }
    if (!getProfile(o.from)) fail(`unknown profile "${o.from}"`);
    if (!getProfile(o.to)) fail(`unknown profile "${o.to}"`);
    if (o.scope && o.scope !== 'user' && o.scope !== 'local') fail('--scope must be "user" or "local"');
    const t = resolveCopyTarget(o, process.cwd());
    const res = copyServer({ from: o.from, name: o.name, sourceScope: t.sourceScope, sourceProject: t.sourceProject, to: o.to, targetScope: t.targetScope, targetProject: t.targetProject });
    if (res.error) fail(res.error);
    const where = res.scope === 'local' ? `local: ${res.project}` : 'user (everywhere)';
    const verb = res.replaced ? 'replaced' : 'copied';
    console.log(`${colorize('green', '✔')} ${verb} "${o.name}" ${o.from} → ${o.to} (${where})`);
    if (res.scope === 'local') console.log(dim('   loads when you run that account in that folder'));
    return 0;
  }
  fail('usage: ccm mcp [list | share <name> [--from <profile>] | unshare <name> | copy <name> --from <p> --to <p> [--scope user|local] [--project <path>]]');
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
  const code = launchProfile(name, [], { intent: 'login' });
  const p = refreshIdentity(name);
  if (p?.email) console.log(`\n${colorize('green', '✔')} ${bold(name)} registered as ${bold(p.email)} (${p.plan ?? 'unknown plan'})`);
  else console.log(`\n${colorize('yellow', '!')} No login detected yet — launch it later with ${bold(`ccm ${name}`)} and run /login.`);
  return code;
}

async function loginCmd(args) {
  const name = args[0];
  if (!name) fail('usage: ccm login <name>');
  if (!getProfile(name)) fail(`unknown profile "${name}" — run: ccm list`);
  console.log(`Signing in to ${bold(name)} — complete the login in Claude Code, then ${dim('/exit')}.\n`);
  const code = launchProfile(name, args.slice(1), { intent: 'login' });
  const p = refreshIdentity(name);
  if (p?.email) console.log(`\n${colorize('green', '✔')} ${bold(name)} logged in as ${bold(p.email)} (${p.plan ?? 'unknown plan'})`);
  else console.log(`\n${colorize('yellow', '!')} No login detected yet — re-run ${bold(`ccm login ${name}`)} and complete /login.`);
  return code;
}

async function importCmd(args) {
  const name = args.find((a) => !a.startsWith('-')) ?? 'main';
  const withHistory = !args.includes('--no-history');
  if (!validName(name)) fail(`invalid name "${name}"`);
  if (getProfile(name)) fail(`profile "${name}" already exists`);
  if (!hasDefaultLogin()) fail(`no login found in ${DEFAULT_CLAUDE_DIR} — run claude once and log in first`);
  registerProfile(name);
  setupProfileDir(name);
  importDefaultInto(name, { withHistory });
  if (withHistory) console.log(dim('Copied session history — past conversations show up in --resume.'));
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
  removeProfile(name);
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
  ccm                     pinned account here? launch it — otherwise the account board
                          (full-screen split-flap TUI: pick, add accounts, transfer, doctor)
  ccm <name> [args…]      launch Claude Code on that account (args pass through, e.g. --resume)
  ccm pick                open the account board (ignores pin)
  ccm ui [--port N]       the board as a local web page (launch accounts into WT tabs)

${bold('Accounts')}
  ccm import [name]       adopt your current ~/.claude login as a profile, incl. session
                          history so --resume sees past chats (default: main; --no-history to skip)
  ccm add <name>          create a profile and log in to another account
  ccm login <name>        sign back in to a profile whose saved token was cleared
  ccm list                all profiles at a glance
  ccm remove <name>       delete a profile (asks first; --yes to skip)

${bold('Sessions')}
  ccm move-session <to> [id] [--no-launch]
                          copy the latest session for this folder (or a given id)
                          to another account and resume it there

${bold('Insight')}
  ccm status [--fresh]    quota dashboard for every account (--json for raw data)
  ccm statusline install  show active account + quota inside Claude Code's statusline
  ccm notify on|off|test  Windows toasts when an account crosses 80%/95% or resets
  ccm doctor              health-check profiles, junctions, tokens, integrations

${bold('Per-profile config')} ${dim('(merged over the shared layer at launch)')}
  ccm override <name> [key=value ...] [--unset key] [--clear]
                          settings overrides, e.g. ccm override work model=opus theme=dark
                          ~/.ccm/overrides/<name>.CLAUDE.md is appended to shared CLAUDE.md
                          memory=private|shared opts an account out of / into the pooled
                          per-project auto-memory (shared is the default)
  ccm mcp list            shared + each account's user/local MCP servers
  ccm mcp share <name> [--from <profile>] / unshare <name>
  ccm mcp copy <name> --from <p> --to <p> [--scope user|local] [--project <path>]
                          copy one account's MCP server to another account

${bold('Pinning & Windows Terminal')}
  ccm pin <name>          this folder (and below) always uses that account
  ccm unpin               remove the pin in this folder
  ccm wt install          one Windows Terminal profile per account (colored tabs)

Profiles live in ~/.ccm/profiles/<name> — each is an isolated CLAUDE_CONFIG_DIR,
so different accounts can run at the same time in different terminals.
Shared config (settings.json, CLAUDE.md, mcp.json, agents, skills, commands,
hooks) is managed once in ~/.ccm/shared and composed into every profile,
with per-profile overrides from ~/.ccm/overrides.`);
  return 0;
}

const [cmd, ...rest] = process.argv.slice(2);
let exitCode = 0;
try {
  switch (cmd) {
    case undefined: exitCode = await defaultAction(); break;
    case 'pick': exitCode = await pickAndLaunch(listProfiles()); break;
    case 'add': exitCode = await addCmd(rest); refreshWtIfInstalled(); break;
    case 'login': exitCode = await loginCmd(rest); refreshWtIfInstalled(); break;
    case 'import': exitCode = await importCmd(rest); refreshWtIfInstalled(); break;
    case 'list': case 'ls': console.log(renderList(listProfiles())); break;
    case 'remove': case 'rm': exitCode = await removeCmd(rest); refreshWtIfInstalled(); break;
    case 'status': case 'st': exitCode = await statusCmd(rest); break;
    case 'refresh': exitCode = await refreshCmd(); break;
    case 'pin': exitCode = pinCmd(rest); break;
    case 'unpin': exitCode = unpinCmd(); break;
    case 'ui': case 'board': exitCode = uiCmd(rest); break;
    case 'move-session': exitCode = await moveSessionCmd(rest); break;
    case 'override': exitCode = overrideCmd(rest); break;
    case 'mcp': exitCode = await mcpCmd(rest); break;
    case 'wt': exitCode = wtCmd(rest); break;
    case 'notify': exitCode = notifyCmd(rest); break;
    case 'doctor': {
      const { text, failures } = await runDoctor();
      console.log(text);
      exitCode = failures ? 1 : 0;
      break;
    }
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
