// 把 Seedream 新姿势批量落盘：下载 → 抠透明 → 裁边 → 写入 variants
// 用法：node tools/add-poses-v10.mjs [--skip-matte] [--only deepseek]
// 约定：v4/v5 覆盖原姿势；v10/v11（deepseek v10–v15）为新增档位
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { trimAlpha } from './trim.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VARIANTS = path.join(ROOT, 'assets', 'characters', 'transparent', 'variants');
const WORK = path.join(ROOT, 'work');
const RAW = path.join(WORK, 'poses-raw');
const MATTE = path.join(WORK, 'poses-matte');

// 文件名 → 生成结果的 CDN 地址
const POSES = {
  'deepseek_chibi_v4.png': 'cxsYNaJP2O',
  'deepseek_chibi_v5.png': 'rESc2N8x8u',
  'deepseek_chibi_v10.png': '1G77E8jqPl',
  'deepseek_chibi_v11.png': 'eXh56z5bNf',
  'deepseek_chibi_v12.png': 'sqFi8pK8hU',
  'deepseek_chibi_v13.png': 'jWHv254dCA',
  'deepseek_chibi_v14.png': 'yUJVNJRpKz',
  'deepseek_chibi_v15.png': '0JAKN3n11P',
  'gpt_chibi_v4.png': 'gOnxFdmPeZ',
  'gpt_chibi_v5.png': 'jT09AaB3EU',
  'gpt_chibi_v10.png': 'mQVcYc1hCD',
  'gpt_chibi_v11.png': '7LrSMTHSr6',
  'claude_chibi_v4.png': 'rY6AvUS2vd',
  'claude_chibi_v5.png': 'L6KGPjO6w7',
  'claude_chibi_v10.png': 'fBhKVsDh5f',
  'claude_chibi_v11.png': 'G6HWbR8Iv4',
  'gemini_chibi_v4.png': 'zVv62ssYms',
  'gemini_chibi_v5.png': 'uWBGD6GrDK',
  'gemini_chibi_v10.png': 'gMGvX4CJEF',
  'gemini_chibi_v11.png': 'A8dXOsJUsg',
  'grok_chibi_v4.png': 'lC5n4Sx2Us',
  'grok_chibi_v5.png': 'Ewj94dZiX8',
  'grok_chibi_v10.png': '7JlqmJDpOk',
  'grok_chibi_v11.png': 'wM46QE5AYP',
  'glm_chibi_v4.png': 'D5THbdj4SZ',
  'glm_chibi_v5.png': 'RjS3tcy4m8',
  'glm_chibi_v10.png': 'mZFci89U9f',
  'glm_chibi_v11.png': 'r2VsFAHFnY',
  'qwen_chibi_v4.png': 'nLA8PzvIVu',
  'qwen_chibi_v5.png': 'RRxeHwUXD4',
  'qwen_chibi_v10.png': 'UUK8O9GLOz',
  'qwen_chibi_v11.png': 'eOqNVd2ej4',
  'kimi_chibi_v4.png': 'xCupYmGgyl',
  'kimi_chibi_v5.png': 'gzVTwbtP0A',
  'kimi_chibi_v10.png': 'Trn7AE9v4A',
  'kimi_chibi_v11.png': 'teDO8PevRj',
};

const argv = process.argv.slice(2);
const skipMatte = argv.includes('--skip-matte');
const onlyIdx = argv.indexOf('--only');
const only = onlyIdx >= 0 ? argv[onlyIdx + 1] : '';

const urlOf = (id) => `https://aka.doubaocdn.com/s/${id}`;

async function download(url, file) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载失败 ${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length < 1024) throw new Error(`下载内容过小 ${url}`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
  return buf.length;
}

// 调 mediakit 抠图，返回临时 URL（24h 有效，立即下载）
function removeBg(imageUrl) {
  const out = execFileSync('mediakit-cli', ['image', 'remove-image-background', '--image-url', imageUrl, '--scene', 'general', '--output-format', 'png'], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  let json;
  try {
    json = JSON.parse(out);
  } catch {
    const m = out.match(/\{.*\}/s);
    if (!m) throw new Error('抠图返回无法解析：' + out.slice(0, 400));
    json = JSON.parse(m[0]);
  }
  const u = json.image_url || (json.data && json.data.image_url);
  if (!u) throw new Error('抠图没有返回 image_url：' + JSON.stringify(json).slice(0, 400));
  return u;
}

fs.mkdirSync(RAW, { recursive: true });
fs.mkdirSync(MATTE, { recursive: true });
fs.mkdirSync(VARIANTS, { recursive: true });

// 1) 备份将被覆盖的旧图
const backup = path.join(WORK, `variants-backup-${process.env.DIARY_BACKUP_TAG || 'poses'}`);
fs.mkdirSync(backup, { recursive: true });
for (const name of Object.keys(POSES)) {
  const old = path.join(VARIANTS, name);
  if (fs.existsSync(old)) fs.copyFileSync(old, path.join(backup, name));
}

let ok = 0;
const fails = [];
for (const [name, id] of Object.entries(POSES)) {
  if (only && !name.startsWith(only)) continue;
  const rawFile = path.join(RAW, name);
  const matteFile = path.join(MATTE, name);
  try {
    if (!fs.existsSync(rawFile)) await download(urlOf(id), rawFile);
    if (!skipMatte) {
      const tmpUrl = removeBg(urlOf(id));
      await download(tmpUrl, matteFile);
    }
    const src = skipMatte ? rawFile : matteFile;
    const r = await trimAlpha(src, path.join(VARIANTS, name));
    console.log(`${name} ${r.from} → ${r.to}`);
    ok++;
  } catch (e) {
    fails.push(`${name}: ${e.message}`);
    console.log(`FAIL ${name}: ${e.message}`);
  }
}

console.log(`\n完成 ${ok}/${Object.keys(POSES).length}，备份目录 ${backup}`);
if (fails.length) {
  console.log('失败项：\n' + fails.join('\n'));
  process.exitCode = 1;
}
