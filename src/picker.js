import { colorize, bold, dim } from './util.js';
import { isRunning } from './launch.js';
import { loadCache, headroom } from './usage.js';

function rowText(p, usage, selected, isBest) {
  const cursor = selected ? colorize('cyan', '❯') : ' ';
  const name = selected ? bold(p.name.padEnd(14)) : p.name.padEnd(14);
  const email = (p.email ?? '(email unknown)').padEnd(30);
  const bits = [];
  for (const w of usage?.windows ?? []) {
    const short = w.label.startsWith('session') ? '5h' : w.label === 'week (all models)' ? 'wk' : null;
    if (short) bits.push(`${short} ${Math.round(w.percent)}%`);
  }
  const quota = bits.length ? bits.join(' · ') : 'usage: n/a';
  const run = isRunning(p.name) ? colorize('green', '  RUNNING') : '';
  const best = isBest ? colorize('green', '  ✦ most headroom') : '';
  return ` ${cursor} ${colorize(p.color, '●')} ${name} ${dim(email)} ${dim(quota)}${run}${best}`;
}

// Most available quota first; profiles with no data go last, original order kept.
export function sortByHeadroom(profiles, cache) {
  return profiles.map((p, i) => ({ p, i, h: headroom(cache[p.name]) }))
    .sort((a, b) => (b.h ?? -1) - (a.h ?? -1) || a.i - b.i)
    .map((x) => x.p);
}

// Arrow-key profile picker. Resolves to a profile name, or null if cancelled.
export function pickProfile(unsorted, { preselect = null } = {}) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) return Promise.resolve(null);
  const cache = loadCache();
  const profiles = sortByHeadroom(unsorted, cache);
  const bestName = profiles.length > 1 && headroom(cache[profiles[0].name]) != null ? profiles[0].name : null;
  let index = Math.max(0, profiles.findIndex((p) => p.name === preselect));
  const lineCount = profiles.length + 2;

  const render = (first = false) => {
    const lines = [
      bold('  Pick an account') + dim('   ↑↓ move · enter launch · q quit · sorted by available quota'),
      ...profiles.map((p, i) => rowText(p, cache[p.name], i === index, p.name === bestName)),
      '',
    ];
    if (!first) process.stdout.write(`\x1b[${lineCount}A`);
    process.stdout.write(lines.map((l) => `\x1b[2K${l}`).join('\n') + '\n');
  };

  return new Promise((resolve) => {
    process.stdout.write('\x1b[?25l');
    process.stdin.setRawMode(true);
    process.stdin.resume();
    render(true);

    const done = (value) => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener('data', onKey);
      process.stdout.write('\x1b[?25h');
      resolve(value);
    };

    const onKey = (buf) => {
      const key = buf.toString();
      if (key === '\x03' || key === 'q' || key === '\x1b') return done(null);
      if (key === '\r' || key === '\n') return done(profiles[index].name);
      if (key === '\x1b[A' || key === 'k') index = (index - 1 + profiles.length) % profiles.length;
      else if (key === '\x1b[B' || key === 'j') index = (index + 1) % profiles.length;
      else if (/^[1-9]$/.test(key) && +key <= profiles.length) {
        index = +key - 1;
        render();
        return done(profiles[index].name);
      } else return;
      render();
    };
    process.stdin.on('data', onKey);
  });
}
