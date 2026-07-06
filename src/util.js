import fs from 'node:fs';
import path from 'node:path';

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

export function writeJson(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + '\n');
}

const COLOR_CODES = {
  cyan: '36', magenta: '35', yellow: '33', green: '32',
  blue: '34', red: '31', gray: '90', white: '37',
};

function ansiEnabled() {
  return !process.env.NO_COLOR;
}

export function paint(code, s) {
  return ansiEnabled() ? `\x1b[${code}m${s}\x1b[0m` : String(s);
}

export const colorize = (color, s) => paint(COLOR_CODES[color] ?? '0', s);
export const bold = (s) => paint('1', s);
export const dim = (s) => paint('2', s);

export function bar(percent, width = 20) {
  const pct = Math.max(0, Math.min(100, percent ?? 0));
  const filled = Math.round((pct / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

export function severityColor(percent, severity = 'normal') {
  if (severity === 'exceeded' || percent >= 90) return 'red';
  if (severity === 'warning' || percent >= 70) return 'yellow';
  return 'green';
}

// "in how long" for a future ISO timestamp: "2h 05m", "3d 4h", "12m", "now"
export function timeUntil(iso, now = Date.now()) {
  if (!iso) return '?';
  const ms = new Date(iso).getTime() - now;
  if (Number.isNaN(ms)) return '?';
  if (ms <= 0) return 'now';
  const mins = Math.floor(ms / 60_000);
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m`;
}

// "how long ago" for a past ISO timestamp: "5m ago", "3h ago", "2d ago", "—"
export function timeAgo(iso, now = Date.now()) {
  if (!iso) return '—';
  const ms = now - new Date(iso).getTime();
  if (Number.isNaN(ms)) return '—';
  if (ms < 60_000) return 'just now';
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
