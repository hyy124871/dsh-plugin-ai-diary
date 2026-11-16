import fs from 'node:fs';
import path from 'node:path';

const base = 'D:/harness/resources/app.asar/dsh';
const out = [];

out.push('root: ' + fs.readdirSync(base).join(', '));

const nm = path.join(base, 'node_modules', '@deepseek-ai');
if (fs.existsSync(nm)) {
  for (const d of fs.readdirSync(nm)) {
    const pj = path.join(nm, d, 'package.json');
    let bin = '';
    let ver = '';
    try {
      const j = JSON.parse(fs.readFileSync(pj, 'utf8'));
      ver = j.version || '';
      if (j.bin) bin = JSON.stringify(j.bin);
    } catch {}
    out.push(`${d}  v${ver}  ${bin}`);
  }
} else {
  out.push('no @deepseek-ai under dsh/node_modules');
}

console.log(out.join('\n'));
