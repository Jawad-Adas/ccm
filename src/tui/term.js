// Minimal truecolor terminal layer: alt-screen lifecycle, key decoding, and a
// cell canvas that serializes one frame per write (no flicker, no deps).

const colorOn = !process.env.NO_COLOR;

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16 & 255, n >> 8 & 255, n & 255];
}

export function styleCode({ fg, bold, dim } = {}) {
  if (!colorOn) return '';
  const parts = ['0'];
  if (bold) parts.push('1');
  if (dim) parts.push('2');
  if (fg) parts.push(`38;2;${hexRgb(fg).join(';')}`);
  return `\x1b[${parts.join(';')}m`;
}

export class Canvas {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.cells = Array.from({ length: h }, () => Array.from({ length: w }, () => ({ ch: ' ', style: null })));
  }

  put(x, y, text, style = null) {
    if (y < 0 || y >= this.h) return;
    const chars = [...String(text)];
    for (let i = 0; i < chars.length; i++) {
      const cx = x + i;
      if (cx < 0 || cx >= this.w) continue;
      this.cells[y][cx] = { ch: chars[i], style };
    }
  }

  // Serialize to one ANSI string. `scramble(cell, x, y)` may substitute the
  // displayed character — the split-flap cascade hooks in here.
  toAnsi(scramble = null) {
    const out = [];
    for (let y = 0; y < this.h; y++) {
      let row = '';
      let last;
      for (let x = 0; x < this.w; x++) {
        const cell = this.cells[y][x];
        const code = styleCode(cell.style ?? {});
        if (code !== last) { row += code; last = code; }
        row += scramble ? scramble(cell, x, y) : cell.ch;
      }
      out.push(row + (colorOn ? '\x1b[0m' : ''));
    }
    return out.join('\n');
  }

  // Plain text (for headless tests).
  toText() {
    return this.cells.map((r) => r.map((c) => c.ch).join('').trimEnd()).join('\n');
  }
}

const KEYMAP = {
  '\x1b[A': 'up', '\x1b[B': 'down', '\x1b[C': 'right', '\x1b[D': 'left',
  '\r': 'enter', '\n': 'enter', '\x1b': 'esc', '\x03': 'ctrl-c',
  '\x7f': 'backspace', '\b': 'backspace', '\t': 'tab',
};

export class Screen {
  constructor() {
    this.out = process.stdout;
    this.onKey = null;
    this.onResize = null;
    this._data = (buf) => {
      const s = buf.toString();
      const key = KEYMAP[s] ?? (s.length === 1 ? s.toLowerCase() : null);
      if (key && this.onKey) this.onKey(key, s); // raw form for text input
    };
    this._resize = () => this.onResize?.();
  }

  get size() {
    return { w: this.out.columns ?? 80, h: this.out.rows ?? 24 };
  }

  enter() {
    this.out.write('\x1b[?1049h\x1b[?25l');
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', this._data);
    this.out.on('resize', this._resize);
  }

  leave() {
    process.stdin.off('data', this._data);
    this.out.off('resize', this._resize);
    process.stdin.setRawMode(false);
    process.stdin.pause();
    this.out.write('\x1b[?25h\x1b[?1049l');
  }

  frame(ansi) {
    this.out.write('\x1b[H' + ansi);
  }
}
