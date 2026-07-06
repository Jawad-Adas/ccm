// The Solari board tokens. Dark-committed: departure boards have no light mode.
// Account hues validated with the dataviz palette checker against #1A1A19
// (all ≥3:1 contrast, worst adjacent CVD ΔE 41.3 — 2026-07-06).
export const INK = '#F5F3EA';        // warm paper white — the flap text
export const INK2 = '#C3C2B7';       // secondary ink
export const MUTED = '#898781';      // labels, empty tiles
export const AMBER = '#FAB219';      // signal amber: time, headers. Time IS the warning.
export const GOOD = '#0CA30C';
export const SERIOUS = '#EC835A';
export const CRITICAL = '#D03B3B';

// Registry color name → validated dark-surface hue ("transit line" colors).
export const HUES = {
  cyan: '#3987E5', magenta: '#D55181', yellow: '#C98500',
  green: '#199E70', blue: '#9085E9', red: '#E66767',
};

export function hueOf(colorName) {
  return HUES[colorName] ?? INK2;
}

// Meter fill color by usage percent: neutral ink until it becomes a warning.
export function meterColor(pct) {
  if (pct >= 95) return CRITICAL;
  if (pct >= 80) return AMBER;
  return INK;
}
