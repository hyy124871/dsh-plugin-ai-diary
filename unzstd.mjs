import { readFileSync } from 'node:fs';
import zlib from 'node:zlib';

const targets = process.argv.slice(2);
for (const p of targets) {
  const buf = readFileSync(p);
  try {
    const out = zlib.zstdDecompressSync(buf).toString('utf8');
    console.log(`=== ${p} ===`);
    console.log(out.slice(0, 4000));
  } catch (e) {
    console.log(`=== ${p} === ERROR ${e.message}`);
  }
}
