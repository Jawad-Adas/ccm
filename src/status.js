import { listProfiles } from './registry.js';
import { isRunning } from './launch.js';
import { getUsage, ERROR_HINTS, DEFAULT_MAX_AGE_MS, isStale } from './usage.js';
import { bar, bold, dim, colorize, severityColor, timeUntil, timeAgo } from './util.js';

export async function gatherStatus({ maxAgeMs = DEFAULT_MAX_AGE_MS, cacheOnly = false } = {}) {
  const profiles = listProfiles();
  return Promise.all(profiles.map(async (p) => ({
    ...p,
    running: isRunning(p.name),
    usage: await getUsage(p.name, { maxAgeMs, cacheOnly }),
  })));
}

export function renderStatus(rows) {
  if (!rows.length) {
    return `No profiles yet.\n  ${dim('ccm import <name>   adopt your current ~/.claude login')}\n  ${dim('ccm add <name>      log in to another account')}`;
  }
  const out = [];
  for (const p of rows) {
    const head = [
      colorize(p.color, '●'),
      bold(p.name),
      p.email ?? dim('(email unknown)'),
    ];
    if (p.plan) head.push(dim(p.plan));
    if (p.organization) head.push(dim(p.organization));
    if (p.running) head.push(colorize('green', 'RUNNING'));
    else if (p.lastUsed) head.push(dim(`last used ${timeAgo(p.lastUsed)}`));
    out.push(head.join('  '));

    const u = p.usage;
    const stale = u && (u.staleError || isStale(u));
    if (u?.windows?.length) {
      const labelWidth = Math.max(...u.windows.map((w) => w.label.length));
      for (const w of u.windows) {
        // Don't paint severity on stale numbers — they may no longer be true.
        const color = stale ? 'gray' : severityColor(w.percent, w.severity);
        out.push(
          `    ${w.label.padEnd(labelWidth)}  ${colorize(color, bar(w.percent))}  ` +
          `${String(Math.round(w.percent)).padStart(3)}%  ${dim(`resets in ${timeUntil(w.resetsAt)}`)}`
        );
      }
      const asOf = timeAgo(u.fetchedAt ? new Date(u.fetchedAt).toISOString() : null);
      if (stale) {
        const hint = u.staleError ? ERROR_HINTS[u.staleError] ?? u.staleError : 'could not refresh';
        out.push(colorize('yellow', `    stale — as of ${asOf} · ${hint}`));
      } else {
        out.push(dim(`    fetched ${asOf}`));
      }
    } else if (u?.error) {
      out.push(`    ${colorize('yellow', ERROR_HINTS[u.error] ?? `usage unavailable (${u.error})`)}`);
    } else {
      out.push(dim('    usage: no data yet — run ccm status again'));
    }
    out.push('');
  }
  return out.join('\n').trimEnd();
}
