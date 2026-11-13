// npm run check — syntax-check every .js file (server, scripts, tests, public) with `node --check`.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '..');
const skip = new Set(['node_modules', 'legacy', 'data', 'logs', '.git']);
let n = 0, bad = 0;
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.js')) {
      n++;
      try { execFileSync(process.execPath, ['--check', p], { stdio: 'pipe' }); }
      catch (err) { bad++; console.error(`✗ ${path.relative(root, p)}\n${err.stderr}`); }
    }
  }
})(root);
console.log(`${n} files checked, ${bad} with syntax errors.`);
process.exit(bad ? 1 : 0);
