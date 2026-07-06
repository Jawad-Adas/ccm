import fs from 'node:fs';
import path from 'node:path';

export const PIN_FILE = '.ccmrc';

// Walk up from `from` looking for a .ccmrc; first line is the profile name.
export function findPin(from = process.cwd()) {
  let dir = path.resolve(from);
  for (;;) {
    const file = path.join(dir, PIN_FILE);
    try {
      const name = fs.readFileSync(file, 'utf8').split(/\r?\n/)[0].trim();
      if (name) return { name, file };
    } catch {}
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function writePin(name, dir = process.cwd()) {
  const file = path.join(dir, PIN_FILE);
  fs.writeFileSync(file, name + '\n');
  return file;
}

export function removePin(dir = process.cwd()) {
  const file = path.join(dir, PIN_FILE);
  if (!fs.existsSync(file)) return null;
  fs.rmSync(file);
  return file;
}
