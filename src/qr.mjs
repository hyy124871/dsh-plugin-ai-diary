// 零依赖二维码：byte 模式 / 纠错 L / 版本 1–10 / mask 固定 0，另附灰度 PNG 编码。
//
// 为什么要自己写：扫码登录得把二维码画给用户看，而插件是零依赖设计（宿主只给 dsh-tools
// 与 canvas，且源码目录里没有 node_modules），系统里也没有现成的二维码库。
//
// 只做登录 URL 够用的最小集合：URL 是 ASCII、长度 <300 字节，版本 1–10 够了。
// mask 固定 0（(r+c)%2==0）：QR 规范允许任意 mask，读码器从格式信息里读 mask 号，
// 少一套 penalty 评分就少一处能出错的地方。
//
// 验证：scripts/qr-login.mjs --selftest 会把矩阵跟 python qrcode 库的矩阵逐模块比对。

import zlib from 'node:zlib';

// ---------- GF(256) ----------
const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
}
const gmul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

/** 生成多项式 ∏(x - α^i)，高次在前，最高次系数为 1（多项式除法要求这个方向） */
function genPoly(n) {
  let poly = [1];
  for (let i = 0; i < n; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j]; // 乘 x
      next[j + 1] ^= gmul(poly[j], EXP[i]); // 乘 α^i
    }
    poly = next;
  }
  return poly;
}

/** Reed-Solomon：返回 ecLen 个纠错码字 */
function rsEncode(data, ecLen) {
  const gen = genPoly(ecLen);
  const res = data.concat(new Array(ecLen).fill(0));
  for (let i = 0; i < data.length; i += 1) {
    const factor = res[i];
    if (!factor) continue;
    for (let j = 0; j < gen.length; j += 1) res[i + j] ^= gmul(gen[j], factor);
  }
  return res.slice(data.length);
}

// ---------- 版本表（纠错等级 L）----------
// [块数, 每块总码字, 每块数据码字]
const BLOCKS_L = {
  1: [[1, 26, 19]],
  2: [[1, 44, 34]],
  3: [[1, 70, 55]],
  4: [[1, 100, 80]],
  5: [[1, 134, 108]],
  6: [[2, 86, 68]],
  7: [[2, 98, 78]],
  8: [[2, 121, 97]],
  9: [[2, 146, 116]],
  10: [[2, 86, 68], [2, 69, 69]],
};

const ALIGN_POS = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

const MAX_VERSION = 10;

function dataCodewords(version) {
  return BLOCKS_L[version].reduce((n, [count, , data]) => n + count * data, 0);
}

function pickVersion(len, version) {
  if (version) {
    if (!BLOCKS_L[version]) throw new Error(`不支持的版本 ${version}（只做 1–${MAX_VERSION}）`);
    if (4 + (version <= 9 ? 8 : 16) + len * 8 > dataCodewords(version) * 8) {
      throw new Error(`内容 ${len} 字节放不进版本 ${version}`);
    }
    return version;
  }
  for (let v = 1; v <= MAX_VERSION; v += 1) {
    const countBits = v <= 9 ? 8 : 16;
    if (4 + countBits + len * 8 <= dataCodewords(v) * 8) return v;
  }
  throw new Error(`内容 ${len} 字节太长，版本 1–${MAX_VERSION} 都放不下`);
}

// ---------- BCH ----------
function bchDigit(n) {
  let d = 0;
  let x = n;
  while (x !== 0) {
    d += 1;
    x >>>= 1;
  }
  return d;
}

function bchTypeInfo(data) {
  let d = data << 10;
  while (bchDigit(d) - bchDigit(0x537) >= 0) d ^= 0x537 << (bchDigit(d) - bchDigit(0x537));
  return ((data << 10) | d) ^ 0x5412;
}

function bchTypeNumber(data) {
  let d = data << 12;
  while (bchDigit(d) - bchDigit(0x1f25) >= 0) d ^= 0x1f25 << (bchDigit(d) - bchDigit(0x1f25));
  return (data << 12) | d;
}

// ---------- 编码 ----------
/**
 * @param {string} text 要编码的内容（按 UTF-8 字节计）
 * @param {{version?: number}} [opts]
 * @returns {{size:number, version:number, modules:number[][]}}
 */
export function qrEncode(text, opts = {}) {
  const bytes = Buffer.from(String(text), 'utf8');
  const version = pickVersion(bytes.length, opts.version);
  const blocks = BLOCKS_L[version];
  const totalData = dataCodewords(version);
  const ecLen = blocks[0][1] - blocks[0][2];

  // 位流：0100(mode) + 字符计数 + 数据
  const bits = [];
  const put = (val, n) => {
    for (let i = n - 1; i >= 0; i -= 1) bits.push((val >>> i) & 1);
  };
  put(4, 4);
  put(bytes.length, version <= 9 ? 8 : 16);
  for (const b of bytes) put(b, 8);

  // 终止符 + 补齐到字节边界
  const remain = totalData * 8 - bits.length;
  put(0, Math.min(4, Math.max(0, remain)));
  while (bits.length % 8 !== 0) bits.push(0);

  const codewords = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j += 1) b = (b << 1) | bits[i + j];
    codewords.push(b);
  }
  const pads = [0xec, 0x11];
  let p = 0;
  while (codewords.length < totalData) {
    codewords.push(pads[p % 2]);
    p += 1;
  }

  // 分块 + RS + 交织
  const dataBlocks = [];
  let off = 0;
  for (const [count, , data] of blocks) {
    for (let i = 0; i < count; i += 1) {
      dataBlocks.push(codewords.slice(off, off + data));
      off += data;
    }
  }
  const ecBlocks = dataBlocks.map((d) => rsEncode(d, ecLen));
  const out = [];
  const maxData = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxData; i += 1) {
    for (const b of dataBlocks) if (i < b.length) out.push(b[i]);
  }
  for (let i = 0; i < ecLen; i += 1) {
    for (const b of ecBlocks) out.push(b[i]);
  }

  // ---------- 矩阵 ----------
  const size = version * 4 + 17;
  const modules = Array.from({ length: size }, () => new Array(size).fill(null));
  const set = (r, c, v) => {
    if (r < 0 || r >= size || c < 0 || c >= size) return;
    modules[r][c] = v ? 1 : 0;
  };

  // finder + separator
  const finder = (r0, c0) => {
    for (let i = -1; i <= 7; i += 1) {
      for (let j = -1; j <= 7; j += 1) {
        const inner = i >= 0 && i <= 6 && j >= 0 && j <= 6;
        const ring = inner && ((i === 0 || i === 6) || (j === 0 || j === 6));
        const core = i >= 2 && i <= 4 && j >= 2 && j <= 4;
        set(r0 + i, c0 + j, ring || core);
      }
    }
  };
  finder(0, 0);
  finder(0, size - 7);
  finder(size - 7, 0);

  // timing
  for (let i = 8; i < size - 8; i += 1) {
    if (modules[6][i] === null) set(6, i, i % 2 === 0);
    if (modules[i][6] === null) set(i, 6, i % 2 === 0);
  }

  // alignment
  const pos = ALIGN_POS[version];
  for (const r of pos) {
    for (const c of pos) {
      if ((r === 6 && c === 6) || (r === 6 && c === size - 7) || (r === size - 7 && c === 6)) continue;
      for (let i = -2; i <= 2; i += 1) {
        for (let j = -2; j <= 2; j += 1) {
          set(r + i, c + j, Math.max(Math.abs(i), Math.abs(j)) !== 1);
        }
      }
    }
  }

  // 固定深色模块
  set(size - 8, 8, 1);

  // 格式信息（纠错 L = 01，mask = 0）
  const fmt = bchTypeInfo((0b01 << 3) | 0);
  for (let i = 0; i < 15; i += 1) {
    const on = ((fmt >> i) & 1) === 1;
    if (i < 6) set(i, 8, on);
    else if (i < 8) set(i + 1, 8, on);
    else set(size - 15 + i, 8, on);
    if (i < 8) set(8, size - i - 1, on);
    else if (i < 9) set(8, 15 - i, on);
    else set(8, 15 - i - 1, on);
  }

  // 版本信息（v>=7）
  if (version >= 7) {
    const ver = bchTypeNumber(version);
    for (let i = 0; i < 18; i += 1) {
      const on = ((ver >> i) & 1) === 1;
      set(Math.floor(i / 3), (i % 3) + size - 11, on);
      set((i % 3) + size - 11, Math.floor(i / 3), on);
    }
  }

  // 数据放置（右下角起，两列一组蛇形，mask 0）
  let inc = -1;
  let row = size - 1;
  let bitIndex = 7;
  let byteIndex = 0;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1;
    for (;;) {
      for (let c = 0; c < 2; c += 1) {
        const cc = col - c;
        if (modules[row][cc] !== null) continue;
        let dark = false;
        if (byteIndex < out.length) dark = ((out[byteIndex] >>> bitIndex) & 1) === 1;
        if ((row + cc) % 2 === 0) dark = !dark;
        modules[row][cc] = dark ? 1 : 0;
        bitIndex -= 1;
        if (bitIndex === -1) {
          byteIndex += 1;
          bitIndex = 7;
        }
      }
      row += inc;
      if (row < 0 || row >= size) {
        row -= inc;
        inc = -inc;
        break;
      }
    }
  }

  return { size, version, modules };
}

// ---------- PNG（8 位灰度，零依赖）----------
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}

/** 把二维码渲染成 PNG：scale 是每个模块的像素边长，margin 是静区模块数 */
export function qrPng(text, opts = {}) {
  const { size, modules } = qrEncode(text, { version: opts.version });
  const scale = Math.max(2, Number(opts.scale) || 8);
  const margin = Number.isFinite(opts.margin) ? Number(opts.margin) : 4;
  const dim = (size + margin * 2) * scale;

  const raw = Buffer.alloc(dim * (dim + 1), 255);
  const stride = dim + 1;
  for (let y = 0; y < dim; y += 1) raw[y * stride] = 0; // filter: none
  for (let my = 0; my < size; my += 1) {
    for (let mx = 0; mx < size; mx += 1) {
      if (!modules[my][mx]) continue;
      const y0 = (my + margin) * scale;
      const x0 = (mx + margin) * scale;
      for (let y = 0; y < scale; y += 1) {
        const line = (y0 + y) * stride + 1 + x0;
        raw.fill(0, line, line + scale);
      }
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(dim, 0);
  ihdr.writeUInt32BE(dim, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // grayscale
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
