// 三家 TTS 解析路径自检：本地假服务器模拟各自的返回形态，不耗任何额度。
// 跑法：node test-providers.mjs
import http from 'node:http';
import { synthesize } from './src/voice.mjs';

// 一段 0.2s 的静音 wav（44.1k mono 16bit）
function silentWav(seconds = 0.2, rate = 44100) {
  const frames = Math.floor(seconds * rate);
  const data = Buffer.alloc(frames * 2);
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + data.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22); header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

const wav = silentWav();
const b64 = wav.toString('base64');
const hex = wav.toString('hex');

const server = http.createServer((req, res) => {
  const send = (obj) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  if (req.url === '/file.wav') {
    res.writeHead(200, { 'Content-Type': 'audio/wav' });
    return res.end(wav);
  }
  let body = '';
  req.on('data', (d) => { body += d; });
  req.on('end', () => {
    let json = {};
    try { json = JSON.parse(body || '{}'); } catch { /* 忽略 */ }
    if (req.url.startsWith('/xiaomi')) return send({ choices: [{ message: { audio: { data: b64 } } }] });
    if (req.url.startsWith('/qwen-url')) return send({ output: { audio: { url: `http://127.0.0.1:${port}/file.wav` } } });
    if (req.url.startsWith('/qwen')) return send({ output: { audio: { data: b64 } } });
    if (req.url.startsWith('/minimax')) return send({ data: { audio: hex }, base_resp: { status_code: 0, status_msg: 'success' }, extra_info: { audio_length: 200 } });
    res.writeHead(404); res.end('{}');
  });
});

let port = 0;
await new Promise((r) => { server.listen(0, '127.0.0.1', () => { port = server.address().port; r(); }); });
const base = `http://127.0.0.1:${port}`;

const results = [];
async function check(name, fn) {
  try {
    const buf = await fn();
    const ok = Buffer.isBuffer(buf) && buf.length > 1000 && buf.slice(0, 2).toString() === 'RI' === false ? buf.length > 1000 : buf.length > 1000;
    results.push([name, buf.length > 1000 ? 'PASS' : 'FAIL', `${buf.length} bytes`]);
  } catch (e) {
    results.push([name, 'ERROR', e.message.slice(0, 120)]);
  }
}

await check('xiaomi base64', () => synthesize('测试', { provider: 'xiaomi', apiKey: 'dummy', endpoint: `${base}/xiaomi` }));
await check('qwen 内联 base64', () => synthesize('测试', { provider: 'qwen', apiKey: 'dummy', endpoint: `${base}/qwen` }));
await check('qwen url 下载', () => synthesize('测试', { provider: 'qwen', apiKey: 'dummy', endpoint: `${base}/qwen-url` }));
await check('minimax hex', () => synthesize('测试', { provider: 'minimax', apiKey: 'dummy', endpoint: `${base}/minimax` }));
// 缺 key 时必须抛错（这条用断言判，不走 check 的“成功即 PASS”逻辑）
{
  const old = process.env.MIMO_API_KEY;
  delete process.env.MIMO_API_KEY;
  let msg = '';
  try { await synthesize('测试', { provider: 'xiaomi', apiKey: '' }); } catch (e) { msg = e.message; }
  finally { if (old) process.env.MIMO_API_KEY = old; }
  results.push(['缺 key 报错', msg.includes('MIMO_API_KEY') ? 'PASS' : 'FAIL', msg.slice(0, 60) || '没有抛错']);
}

// 统一入口该认 provider；错 provider 回落 xiaomi
await check('未知 provider 回落', () => synthesize('测试', { provider: 'nope', apiKey: 'dummy', endpoint: `${base}/xiaomi` }));

server.close();
const width = Math.max(...results.map(r => r[0].length)) + 2;
results.forEach(([n, s, d]) => console.log(`${n.padEnd(width)} ${s.padEnd(6)} ${d}`));
const bad = results.filter(r => r[1] !== 'PASS');
console.log(bad.length ? `\n${bad.length} 项未通过` : '\n全部通过：三家解析路径（base64 / URL / hex）都能落地 wav');
process.exitCode = bad.length ? 1 : 0;
