import { spawn } from 'node:child_process';
import { loadConfig, saveConfig } from './registry.js';

// Usage buckets: 0 = fine (<80), 1 = warning (80-94), 2 = critical (>=95).
// A toast fires only when a window crosses UP into a bucket, or drops back to
// 0 from >=1 (quota reset → "fresh again"). No repeats while a bucket holds.
export function bucketFor(percent) {
  if (percent >= 95) return 2;
  if (percent >= 80) return 1;
  return 0;
}

// Compare two usage caches → notification events per profile.
export function diffNotifications(prev, next) {
  const events = [];
  for (const [name, entry] of Object.entries(next ?? {})) {
    if (!entry?.windows?.length) continue;
    const prevWindows = new Map((prev?.[name]?.windows ?? []).map((w) => [w.label, w]));
    const warns = [];
    let fresh = false;
    for (const w of entry.windows) {
      const pb = bucketFor(prevWindows.get(w.label)?.percent ?? 0);
      const nb = bucketFor(w.percent);
      if (nb > pb) warns.push({ label: w.label, percent: Math.round(w.percent), resetsAt: w.resetsAt, bucket: nb });
      else if (pb >= 1 && nb === 0) fresh = true;
    }
    if (warns.length) events.push({ profile: name, kind: 'warn', windows: warns });
    else if (fresh) events.push({ profile: name, kind: 'fresh', windows: [] });
  }
  return events;
}

export function notificationsEnabled() {
  return loadConfig().notifications?.enabled !== false;
}

export function setNotificationsEnabled(enabled) {
  const cfg = loadConfig();
  cfg.notifications = { ...(cfg.notifications ?? {}), enabled };
  saveConfig(cfg);
}

// Windows toast via the WinRT API from PowerShell. Uses PowerShell's own
// AppUserModelID so no app registration is needed. Fire-and-forget.
export function sendToast(title, body) {
  if (process.platform !== 'win32') {
    console.error(`[notify] ${title}: ${body}`);
    return;
  }
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const xml = `<toast><visual><binding template="ToastGeneric"><text>${esc(title)}</text><text>${esc(body)}</text></binding></visual></toast>`;
  const script = [
    '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null',
    '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime] | Out-Null',
    '$xml = New-Object Windows.Data.Xml.Dom.XmlDocument',
    `$xml.LoadXml('${xml.replace(/'/g, "''")}')`,
    "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show([Windows.UI.Notifications.ToastNotification]::new($xml))",
  ].join('; ');
  spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-Command', script], {
    detached: true, stdio: 'ignore', windowsHide: true,
  }).unref();
}
