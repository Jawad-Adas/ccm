// The signature: a split-flap cascade. On load and refresh, cells cycle
// through characters and settle left-to-right like a Solari departure board.

const FLAP_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789·▮%';

export class Cascade {
  // Sweep left→right with slight per-row lag and jitter; ~600ms total.
  constructor(now = Date.now()) {
    this.t0 = now;
    this.jitter = new Map();
  }

  settled(x, y, now = Date.now()) {
    let j = this.jitter.get(`${x},${y}`);
    if (j === undefined) {
      j = Math.random() * 160;
      this.jitter.set(`${x},${y}`, j);
    }
    return now - this.t0 >= x * 5 + y * 8 + j + 80;
  }

  active(w, h, now = Date.now()) {
    return now - this.t0 < w * 5 + h * 8 + 260;
  }

  scrambler(now = Date.now()) {
    return (cell, x, y) => {
      if (cell.ch === ' ' || this.settled(x, y, now)) return cell.ch;
      return FLAP_CHARS[(Math.random() * FLAP_CHARS.length) | 0];
    };
  }
}

// 3-row CCM wordmark; the middle row renders dim — the flap seam.
export const WORDMARK = [
  '█▀▀▀ █▀▀▀ █▀▄▀█',
  '█    █    █ ▀ █',
  '▀▀▀▀ ▀▀▀▀ ▀   ▀',
];

// A quota meter as a row of flap tiles: '██' cells with 1-char gaps
// (the 2px spacer rule), 8 tiles, filled count rounded from percent.
export const METER_TILES = 8;

export function meterCells(percent) {
  const pct = Math.max(0, Math.min(100, percent ?? 0));
  return Math.round((pct / 100) * METER_TILES);
}

export function drawMeter(canvas, x, y, percent, fillStyle, emptyStyle) {
  const filled = meterCells(percent);
  for (let i = 0; i < METER_TILES; i++) {
    canvas.put(x + i * 3, y, i < filled ? '██' : '··', i < filled ? fillStyle : emptyStyle);
  }
  return x + METER_TILES * 3;
}
