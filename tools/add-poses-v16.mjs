// 第二批新姿势落盘：v16–v19（8 角色 × 4），下载 → 抠透明 → 裁边 → 写入 variants
// 用法：node tools/add-poses-v16.mjs [--only deepseek]
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { trimAlpha } from './trim.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VARIANTS = path.join(ROOT, 'assets', 'characters', 'transparent', 'variants');
const WORK = path.join(ROOT, 'work');
const RAW = path.join(WORK, 'poses2-raw');
const MATTE = path.join(WORK, 'poses2-matte');

// v16 剪刀手 / v17 捧脸 / v18 坐地撑手 / v19 递物
const POSES = {
  'deepseek_chibi_v16.png': 'sghbAy0F9S',
  'deepseek_chibi_v17.png': 'HyIhEUNyxu',
  'deepseek_chibi_v18.png': 'Tw1y2EXfpa',
  'deepseek_chibi_v19.png': 'eqoCVwOBPW',
  'gpt_chibi_v16.png': '3M5GGJG3Sh',
  'gpt_chibi_v17.png': 'tZPgYo2fv7',
  'gpt_chibi_v18.png': 'usXh20sllx',
  'gpt_chibi_v19.png': 'aVgS4VDuwu',
  'claude_chibi_v16.png': 'Bmz34HNbYl',
  'claude_chibi_v17.png': 'z65wjAN4DV',
  'claude_chibi_v18.png': '2353X5nk5C',
  'claude_chibi_v19.png': 'ZhaUJ6hKVY',
  'gemini_chibi_v16.png': 'UAv0FrEyFR',
  'gemini_chibi_v17.png': 'Bxrpi7Kmbx',
  'gemini_chibi_v18.png': 'sgUhkqllzu',
  'gemini_chibi_v19.png': 'JVAYQSkxfW',
  'grok_chibi_v16.png': '3l24v9e40y',
  'grok_chibi_v17.png': 'Mu4sfBO1Qj',
  'grok_chibi_v18.png': 'wA4DMRzA4c',
  'grok_chibi_v19.png': 'hhp04J6YFM',
  'glm_chibi_v16.png': 'CfOQOd9I4C',
  'glm_chibi_v17.png': 'TuOpbukp8l',
  'glm_chibi_v18.png': 'dLa8XHG9k8',
  'glm_chibi_v19.png': 'sXTC2SRhls',
  'qwen_chibi_v16.png': 'HlhnUsDXdR',
  'qwen_chibi_v17.png': 'n1uTgVrLZE',
  'qwen_chibi_v18.png': 'qx64LGm4me',
  'qwen_chibi_v19.png': 'gHWV8tj94d',
  'kimi_chibi_v16.png': 'mGzuR3T2A1',
  'kimi_chibi_v17.png': 'aQDNTPxvet',
  'kimi_chibi_v18.png': 'OWqf5LUwia',
  'kimi_chibi_v19.png': 'a290kMwrKj',
};

const onlyIdx = process.argv.indexOf('--only');
const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : '';
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

let ok = 0;
const fails = [];
for (const [name, id] of Object.entries(POSES)) {
  if (only && !name.startsWith(only)) continue;
  const rawFile = path.join(RAW, name);
  const matteFile = path.join(MATTE, name);
  try {
    if (!fs.existsSync(rawFile)) await download(urlOf(id), rawFile);
    const tmpUrl = removeBg(urlOf(id));
    await download(tmpUrl, matteFile);
    const r = await trimAlpha(matteFile, path.join(VARIANTS, name));
    console.log(`${name} ${r.from} → ${r.to}`);
    ok++;
  } catch (e) {
    fails.push(`${name}: ${e.message}`);
    console.log(`FAIL ${name}: ${e.message}`);
  }
}

console.log(`\n完成 ${ok}/${Object.keys(POSES).length}`);
if (fails.length) {
  console.log('失败项：\n' + fails.join('\n'));
  process.exitCode = 1;
}
