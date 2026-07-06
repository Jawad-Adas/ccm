import { headroom } from './usage.js';

// Most available quota first; profiles with no data go last, original order
// kept. The split-flap board (src/tui) is the interactive picker now — this
// ordering is the shared "which account has room" logic.
export function sortByHeadroom(profiles, cache) {
  return profiles.map((p, i) => ({ p, i, h: headroom(cache[p.name]) }))
    .sort((a, b) => (b.h ?? -1) - (a.h ?? -1) || a.i - b.i)
    .map((x) => x.p);
}
