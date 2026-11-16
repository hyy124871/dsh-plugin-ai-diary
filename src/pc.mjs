// PC 引擎调用层（源自 dsh-pc-control，已并入本插件）：
// 每次调用起一个 PowerShell 进程，动作在进程内串行执行；结果经 UTF-8 JSON 文件回传，
// 不碰 stdout 编码，所以中文窗口标题不会变乱码。
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile, rm, readdir, stat, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..');
export const ENGINE_SCRIPT = path.join(ROOT, 'scripts', 'pc-engine.ps1');

export function workDir() {
  const base = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  return path.join(base, 'dsh-plugin-ai-diary', 'pc');
}

export function shotsDir() {
  return path.join(workDir(), 'shots');
}

function tmpDir() {
  return path.join(workDir(), 'tmp');
}

export function stopFilePath() {
  return path.join(workDir(), 'STOP');
}

function powershellPath() {
  const sys = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  const full = path.join(sys, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  return existsSync(full) ? full : 'powershell.exe';
}

async function ensureDirs() {
  await mkdir(tmpDir(), { recursive: true });
  await mkdir(shotsDir(), { recursive: true });
}

// 清掉过期截图，避免目录无限长大
export async function pruneShots(ttlMinutes = 30) {
  const dir = shotsDir();
  const cutoff = Date.now() - Math.max(1, ttlMinutes) * 60 * 1000;
  let entries = [];
  try {
    entries = await readdir(dir);
  } catch {
    return 0;
  }
  let removed = 0;
  for (const name of entries) {
    try {
      const info = await stat(path.join(dir, name));
      if (info.mtimeMs < cutoff) {
        await unlink(path.join(dir, name));
        removed++;
      }
    } catch {
      /* 单个失败不影响调用 */
    }
  }
  return removed;
}

/**
 * 跑一次引擎。payload 交给 pc-engine.ps1，返回 { ok, summary, lines, image, error }。
 */
export async function runEngine(payload, options = {}) {
  if (process.platform !== 'win32') {
    throw new Error('电脑操控只在 Windows 上可用（当前：' + process.platform + '）');
  }
  if (!existsSync(ENGINE_SCRIPT)) throw new Error('找不到引擎脚本：' + ENGINE_SCRIPT);
  await ensureDirs();

  const stamp = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const reqPath = path.join(tmpDir(), 'req-' + stamp + '.json');
  const resPath = path.join(tmpDir(), 'res-' + stamp + '.json');
  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 30000;

  const body = { ...payload };
  if (body.options === undefined) body.options = {};
  await writeFile(reqPath, JSON.stringify(body), 'utf8');

  const result = await new Promise((resolve, reject) => {
    const child = spawn(
      powershellPath(),
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden',
        '-File', ENGINE_SCRIPT, '-Request', reqPath, '-Response', resPath],
      { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] },
    );
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill(); } catch { /* 已退出 */ }
      reject(new Error('引擎超时（' + timeoutMs + 'ms），本次调用已中断'));
    }, timeoutMs);
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > 4000) stderr = stderr.slice(-4000);
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error('启动 PowerShell 失败：' + error.message));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });

  let parsed = null;
  try {
    parsed = JSON.parse(await readFile(resPath, 'utf8'));
  } catch {
    parsed = null;
  }
  await Promise.allSettled([rm(reqPath, { force: true }), rm(resPath, { force: true })]);

  if (!parsed) {
    const tail = (result.stderr || '').trim().split(/\r?\n/).slice(-6).join(' ');
    throw new Error('引擎没有返回结果（exit ' + result.code + '）' + (tail ? '：' + tail : ''));
  }
  return parsed;
}

export async function warmup(options = {}) {
  try {
    await runEngine({ op: 'warmup', options }, options);
    void pruneShots(options.shotTtlMinutes);
    return true;
  } catch {
    return false;
  }
}

export async function readShot(image) {
  return new Uint8Array(await readFile(image.path));
}
