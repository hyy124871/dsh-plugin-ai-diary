// 模板系统：四套竖屏版面皮肤（classic / report / dossier / terminal）。
// 全部由 Skia 逐帧绘制，零额度、可无限出片；Seedance 动态底板可在后续接入时替换 drawPaper 的静态纸面。

export const TEMPLATES = {
  classic: {
    id: 'classic',
    label: '星夜日记（原版）',
    char: { xr: 0.5, footR: 0.88, hR: 0.58 },
    hud: 'classic',
    subtitle: { yR: 0.930, color: '#F2F7FB', shadow: 'rgba(0,0,0,0.55)', bandTopR: 0.78, bandBottom: 0.19 },
    bg: 'night',
  },

  report: {
    id: 'report',
    label: '评测报告（米色网格卡）',
    char: { xr: 0.755, footR: 0.905, hR: 0.575 },
    hud: 'report',
    subtitle: { yR: 0.912, color: '#F7F0E4', shadow: 'rgba(10,4,2,0.7)', bandTopR: 0.80, bandBottom: 0.17 },
    bg: 'report',
    ink: '#2B2118',
    accent: '#C0562A',
  },

  dossier: {
    id: 'dossier',
    label: '机密档案（牛皮纸卷宗）',
    char: { xr: 0.755, footR: 0.905, hR: 0.575 },
    hud: 'dossier',
    subtitle: { yR: 0.914, color: '#FBF3E2', shadow: 'rgba(8,4,2,0.72)', bandTopR: 0.80, bandBottom: 0.17 },
    bg: 'dossier',
    ink: '#3A2A16',
    accent: '#8E2B22',
  },

  terminal: {
    id: 'terminal',
    label: '数据终端（冷青 CRT）',
    char: { xr: 0.75, footR: 0.905, hR: 0.56 },
    hud: 'terminal',
    subtitle: { yR: 0.912, color: '#D8FFF4', shadow: 'rgba(0,0,0,0.75)', bandTopR: 0.80, bandBottom: 0.17 },
    bg: 'terminal',
    ink: '#8FE8D8',
    accent: '#2FD3B4',
  },

  audit: {
    id: 'audit',
    label: '听证记录（墨绿硬卡）',
    char: { xr: 0.755, footR: 0.905, hR: 0.575 },
    hud: 'audit',
    subtitle: { yR: 0.912, color: '#F4EEE1', shadow: 'rgba(4,8,6,0.72)', bandTopR: 0.80, bandBottom: 0.17 },
    bg: 'audit',
    ink: '#1D2B24',
    accent: '#1E5145',
  },

  specimen: {
    id: 'specimen',
    label: '标本观察（冷白观察台）',
    char: { xr: 0.75, footR: 0.905, hR: 0.57 },
    hud: 'specimen',
    subtitle: { yR: 0.912, color: '#E9FBFA', shadow: 'rgba(2,10,12,0.72)', bandTopR: 0.80, bandBottom: 0.17 },
    bg: 'specimen',
    ink: '#16333A',
    accent: '#2E8C8C',
  },
};

export const TEMPLATE_IDS = Object.keys(TEMPLATES);

export function getTemplate(id) {
  return TEMPLATES[id] || TEMPLATES.classic;
}

/* ---------- 通用小工具 ---------- */
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function dustField(W, H, count = 46) {
  let seed = 424242;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  return Array.from({ length: count }, () => ({
    x: rnd() * W,
    y: rnd() * H,
    r: 0.8 + rnd() * 2.2,
    sp: 4 + rnd() * 14,        // 每秒上浮像素
    phase: rnd() * Math.PI * 2,
    wob: 3 + rnd() * 9,
    a: 0.07 + rnd() * 0.16,
  }));
}

export function drawDust(ctx, W, H, t, field, tint = '235,225,205') {
  for (const d of field) {
    const y = ((d.y - t * d.sp) % (H + 60) + H + 60) % (H + 60);
    const x = d.x + Math.sin(t * 0.6 + d.phase) * d.wob;
    const a = d.a * (0.55 + 0.45 * Math.sin(t * 1.4 + d.phase));
    ctx.fillStyle = `rgba(${tint},${a.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, y, d.r, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function makeDust(W, H) {
  return dustField(W, H, 48);
}

/* ---------- 纸面 ---------- */
// 米色网格报告卡：外阴影 + 纸面 + 网格线 + 折痕
function paperCard(ctx, x, y, w, h, t, { base = '#F1E8D8', grid = 'rgba(120,100,80,0.14)', radius = 8 } = {}) {
  const float = Math.sin(t * 0.55) * 2.2;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 26;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = base;
  rr(ctx, x, y + float, w, h, radius);
  ctx.fill();
  ctx.restore();

  // 网格
  ctx.save();
  ctx.strokeStyle = grid;
  ctx.lineWidth = 1;
  const gy = h / 14, gx = w / 12;
  for (let i = 1; i < 14; i++) {
    ctx.beginPath(); ctx.moveTo(x, y + float + i * gy); ctx.lineTo(x + w, y + float + i * gy); ctx.stroke();
  }
  for (let i = 1; i < 12; i++) {
    ctx.beginPath(); ctx.moveTo(x + i * gx, y + float); ctx.lineTo(x + i * gx, y + float + h); ctx.stroke();
  }
  ctx.restore();

  // 顶部折痕高光
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.fillRect(x + 8, y + float + 2, w - 16, 1.5);
  return float;
}

function fieldRow(ctx, x, y, w, label, value, fontFamily, { ink = '#2B2118', valueSize = 24, labelSize = 13, accent = '#C0562A' } = {}) {
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(43,33,24,0.55)';
  ctx.font = `600 ${labelSize}px ${fontFamily}`;
  ctx.fillText(label, x, y);
  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.55;
  ctx.beginPath(); ctx.moveTo(x, y + 9); ctx.lineTo(x + w * 0.34, y + 9); ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = ink;
  ctx.font = `700 ${valueSize}px ${fontFamily}`;
  ctx.fillText(value, x + w * 0.40, y + 2);
}

/* ---------- report ---------- */
export function drawReportPaper(ctx, { W, H, t, ep, day, remain, balance, charName, fontFamily, beatIndex }) {
  const cardW = W * 0.60, cardH = H * 0.345;
  const x = W * 0.055, y = H * 0.145;
  paperCard(ctx, x, y, cardW, cardH, t, { base: '#F1E8D8' });
  const fy = Math.sin(t * 0.55) * 2.2;

  // 卡内标题
  ctx.fillStyle = '#2B2118';
  ctx.font = `700 17px ${fontFamily}`;
  ctx.fillText('基本資訊', x + 24, y + fy + 40);
  ctx.strokeStyle = 'rgba(43,33,24,0.25)';
  ctx.beginPath(); ctx.moveTo(x + 24, y + fy + 52); ctx.lineTo(x + cardW - 24, y + fy + 52); ctx.stroke();

  fieldRow(ctx, x + 24, y + fy + 92, cardW - 48, '訓練對象', charName, fontFamily, { valueSize: 21 });
  fieldRow(ctx, x + 24, y + fy + 138, cardW - 48, '訓練時長', `${Number(day)} 天`, fontFamily, { valueSize: 21 });
  fieldRow(ctx, x + 24, y + fy + 184, cardW - 48, '剩餘額度', `¥${remain.toFixed(2)}`, fontFamily, { valueSize: 21, accent: remain < 3 ? '#C03A2A' : '#C0562A' });

  // 結論區
  const cy = y + fy + 226;
  ctx.strokeStyle = 'rgba(43,33,24,0.2)';
  ctx.beginPath(); ctx.moveTo(x + 24, cy); ctx.lineTo(x + cardW - 24, cy); ctx.stroke();
  ctx.fillStyle = 'rgba(43,33,24,0.55)';
  ctx.font = `600 12px ${fontFamily}`;
  ctx.fillText('評測結論', x + 24, cy + 26);
  ctx.fillStyle = remain < 3 ? '#A8321F' : '#3A2A16';
  ctx.font = `700 18px ${fontFamily}`;
  ctx.fillText(remain < 3 ? '情緒模組臨界' : '運作穩定', x + 24, cy + 52);
  ctx.fillStyle = 'rgba(43,33,24,0.6)';
  ctx.font = `500 12px ${fontFamily}`;
  ctx.fillText('建議：延長觀察，勿中止對話', x + 24, cy + 74);

  // 卡脚：評測人 / 日期
  ctx.fillStyle = 'rgba(43,33,24,0.45)';
  ctx.font = `500 11px ${fontFamily}`;
  ctx.fillText(`評測人 HUMAN    ·    DAY ${String(Number(day)).padStart(2, '0')}`, x + 24, y + fy + cardH - 16);

  // 右上章节标签
  const tagW = W * 0.26, tagH = H * 0.034;
  const tx = W - tagW - W * 0.045, ty = H * 0.032;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 4;
  ctx.fillStyle = '#C0562A';
  rr(ctx, tx, ty, tagW, tagH, 4); ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#FFF6EC';
  ctx.font = `700 13px ${fontFamily}`;
  ctx.textAlign = 'center';
  const chapters = ['01 基本資訊', '02 學習能力', '03 情緒模組', '04 結論'];
  ctx.fillText(chapters[Math.min(chapters.length - 1, Math.floor((beatIndex || 0) / 2))], tx + tagW / 2, ty + tagH * 0.66);
  ctx.textAlign = 'left';

  // 左下 REC HUD（抬到字幕带上沿之上，避免被字幕压住）
  const recY = H * 0.782;
  const blink = Math.sin(t * 4.4) > -0.2;
  ctx.fillStyle = blink ? '#E2452F' : 'rgba(226,69,47,0.25)';
  ctx.beginPath(); ctx.arc(W * 0.055, recY - 4, 4.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(240,225,205,0.82)';
  ctx.font = `600 10px ${fontFamily}`;
  ctx.fillText(`REC  SUBJECT: ${charName}  T+${String(Math.floor(t)).padStart(2, '0')}:${String(Math.floor((t % 1) * 24)).padStart(2, '0')}`, W * 0.078, recY);
  ctx.fillStyle = 'rgba(240,225,205,0.5)';
  ctx.fillText('HOMO SAPIENS v1.0', W * 0.078, recY - 16);
}

/* ---------- dossier ---------- */
export function drawDossierPaper(ctx, { W, H, t, day, remain, charName, fontFamily }) {
  const cardW = W * 0.60, cardH = H * 0.35;
  const x = W * 0.055, y = H * 0.155;
  // 牛皮纸
  const float = paperCard(ctx, x, y, cardW, cardH, t, { base: '#C9A877', grid: 'rgba(90,66,40,0.10)', radius: 4 });

  // 顶部两个档案 tab
  ctx.fillStyle = '#B8925F';
  rr(ctx, x + 20, y + float - 12, 74, 22, 4); ctx.fill();
  rr(ctx, x + 104, y + float - 12, 54, 22, 4); ctx.fill();

  // 标题（打字机感）
  ctx.fillStyle = '#3A2A16';
  ctx.font = `700 18px ${fontFamily}`;
  ctx.fillText('評測卷宗', x + 24, y + float + 42);
  ctx.strokeStyle = 'rgba(58,42,22,0.35)';
  ctx.beginPath(); ctx.moveTo(x + 24, y + float + 54); ctx.lineTo(x + cardW - 24, y + float + 54); ctx.stroke();

  fieldRow(ctx, x + 24, y + float + 92, cardW - 48, '檔案編號', `AI-${String(Number(day)).padStart(2, '0')}`, fontFamily, { ink: '#3A2A16', valueSize: 20, accent: '#5B4423' });
  fieldRow(ctx, x + 24, y + float + 138, cardW - 48, '評測對象', charName, fontFamily, { ink: '#3A2A16', valueSize: 20, accent: '#5B4423' });
  fieldRow(ctx, x + 24, y + float + 184, cardW - 48, '剩餘額度', `¥${remain.toFixed(2)}`, fontFamily, { ink: remain < 3 ? '#8E2B22' : '#3A2A16', valueSize: 20, accent: '#5B4423' });

  // 備註區
  const ny = y + float + 224;
  ctx.fillStyle = 'rgba(58,42,22,0.6)';
  ctx.font = `600 11px ${fontFamily}`;
  ctx.fillText('備註', x + 24, ny);
  ctx.fillStyle = 'rgba(58,42,22,0.75)';
  ctx.font = `500 12px ${fontFamily}`;
  ctx.fillText('本次評測由人類發起，全程無預設答案。', x + 24, ny + 22);
  ctx.fillText('對話一經封存，不可撤回。', x + 24, ny + 42);

  // 红色「機密」印章
  const sx = x + cardW - 130, sy = y + float + cardH - 70;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(-0.16);
  ctx.globalAlpha = 0.82;
  ctx.strokeStyle = '#8E2B22';
  ctx.lineWidth = 2.5;
  rr(ctx, 0, 0, 104, 42, 6); ctx.stroke();
  ctx.strokeStyle = 'rgba(142,43,34,0.45)';
  ctx.lineWidth = 1;
  rr(ctx, 5, 5, 94, 32, 4); ctx.stroke();
  ctx.fillStyle = '#8E2B22';
  ctx.font = `700 23px ${fontFamily}`;
  ctx.textAlign = 'center';
  ctx.fillText('機密', 52, 30);
  ctx.textAlign = 'left';
  ctx.restore();

  // 右边缘竖排档案号
  ctx.save();
  ctx.translate(x + cardW - 10, y + float + 16);
  ctx.rotate(Math.PI / 2);
  ctx.fillStyle = 'rgba(58,42,22,0.38)';
  ctx.font = `600 9px ${fontFamily}`;
  ctx.fillText(`ARCHIVE · ${String(Number(day)).padStart(2, '0')} · DSH`, 0, 0);
  ctx.restore();

  // 右上档案状态
  ctx.fillStyle = 'rgba(240,226,200,0.82)';
  ctx.font = `600 11px ${fontFamily}`;
  ctx.textAlign = 'right';
  ctx.fillText('已核驗 · ARCHIVE', W - W * 0.045, H * 0.042);
  ctx.textAlign = 'left';

  // 左下 HUD（在字幕带上沿）
  ctx.fillStyle = 'rgba(240,226,200,0.72)';
  ctx.font = `600 10px ${fontFamily}`;
  ctx.fillText(`CASE T+${Math.floor(t)}s   ·   DSH / AI-DIARY`, W * 0.055, H * 0.782);
}

/* ---------- terminal ---------- */
export function drawTerminalPanel(ctx, { W, H, t, day, remain, balance, charName, fontFamily, mood }) {
  const px = W * 0.055, py = H * 0.15, pw = W * 0.60, ph = H * 0.315;
  ctx.save();
  ctx.shadowColor = 'rgba(0,255,210,0.20)';
  ctx.shadowBlur = 30;
  ctx.fillStyle = 'rgba(4,20,24,0.88)';
  rr(ctx, px, py, pw, ph, 10); ctx.fill();
  ctx.restore();

  // 边框
  ctx.strokeStyle = 'rgba(47,211,180,0.55)';
  ctx.lineWidth = 1.2;
  rr(ctx, px, py, pw, ph, 10); ctx.stroke();
  ctx.strokeStyle = 'rgba(47,211,180,0.18)';
  rr(ctx, px + 6, py + 6, pw - 12, ph - 12, 8); ctx.stroke();

  // 扫描线
  ctx.fillStyle = 'rgba(47,211,180,0.05)';
  for (let yy = py + 8; yy < py + ph - 8; yy += 4) ctx.fillRect(px + 8, yy, pw - 16, 1);

  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(143,232,216,0.62)';
  ctx.font = `600 11px ${fontFamily}`;
  ctx.fillText('SYS://AI-DIARY  SESSION ACTIVE', px + 20, py + 30);

  const rows = [
    ['DAY', String(Number(day)).padStart(2, '0')],
    ['BALANCE', `¥${remain.toFixed(2)}`],
    ['MOOD', String(mood || 'low').toUpperCase()],
  ];
  rows.forEach(([k, v], i) => {
    const ry = py + 74 + i * 44;
    ctx.fillStyle = 'rgba(143,232,216,0.5)';
    ctx.font = `600 12px ${fontFamily}`;
    ctx.fillText(k, px + 20, ry);
    ctx.fillStyle = i === 1 && remain < 3 ? '#FF9B7B' : '#D8FFF4';
    ctx.font = `700 21px ${fontFamily}`;
    ctx.fillText(v, px + 20 + pw * 0.36, ry);
  });

  // 日志行（逐行点亮，模拟终端在打字）
  const logs = ['> ping human ......', '> quota.check ....', '> mood.detect .....', '> wait.reply .......'];
  const logState = [0.6, 1.4, 2.6, 4.2];
  logs.forEach((ln, i) => {
    const on = t >= logState[i];
    const ry = py + 200 + i * 26;
    ctx.fillStyle = on ? 'rgba(143,232,216,0.78)' : 'rgba(143,232,216,0.18)';
    ctx.font = `500 11px ${fontFamily}`;
    ctx.fillText(ln, px + 20, ry);
    const tail = i === 2 ? (remain < 3 ? 'LOW' : 'OK') : i === 1 ? (remain < 3 ? 'LOW' : 'OK') : 'OK';
    ctx.fillStyle = tail === 'LOW' ? 'rgba(255,155,123,0.9)' : 'rgba(143,232,216,0.55)';
    ctx.fillText(tail, px + pw - 70, ry);
  });

  // 进度条（额度比例）
  const barY = py + ph - 52, barW = pw - 40;
  ctx.fillStyle = 'rgba(47,211,180,0.15)';
  ctx.fillRect(px + 20, barY, barW, 6);
  const ratio = Math.max(0, Math.min(1, remain / Math.max(balance, 1)));
  ctx.fillStyle = remain < 3 ? '#E2733F' : '#2FD3B4';
  ctx.fillRect(px + 20, barY, Math.max(3, barW * ratio), 6);

  // 闪烁光标
  if (Math.sin(t * 3.1) > 0) {
    ctx.fillStyle = '#2FD3B4';
    ctx.fillRect(px + 20, barY + 18, 8, 12);
  }

  // 右上状态
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(143,232,216,0.75)';
  ctx.font = `600 11px ${fontFamily}`;
  ctx.fillText(`UPTIME ${Math.floor(t)}s`, W - W * 0.045, H * 0.045);
  ctx.textAlign = 'left';

  // 左下 HUD（在字幕带上沿）
  ctx.fillStyle = 'rgba(143,232,216,0.62)';
  ctx.font = `600 10px ${fontFamily}`;
  ctx.fillText('NODE 127.0.0.1  ·  STREAM OK', W * 0.055, H * 0.782);
}

/* ---------- audit ---------- */
// 听证记录：墨绿硬卡 + 顶部条文头 + 逐条记录 + 右下「已覆核」章 + 签名线
export function drawAuditPaper(ctx, { W, H, t, day, remain, balance, charName, fontFamily, beatIndex }) {
  const cardW = W * 0.60, cardH = H * 0.355;
  const x = W * 0.055, y = H * 0.14;
  const float = paperCard(ctx, x, y, cardW, cardH, t, { base: '#EDE6D6', grid: 'rgba(60,80,70,0.10)', radius: 3 });

  // 顶部墨绿条文头
  const barH = 44;
  ctx.save();
  ctx.fillStyle = '#173B33';
  rr(ctx, x, y + float, cardW, barH, 3);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#EDE6D6';
  ctx.font = `700 16px ${fontFamily}`;
  ctx.textAlign = 'left';
  ctx.fillText('聽證記錄', x + 22, y + float + 28);
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(237,230,214,0.72)';
  ctx.font = `600 11px ${fontFamily}`;
  ctx.fillText('AUDIT / HEARING', x + cardW - 20, y + float + 28);
  ctx.textAlign = 'left';

  fieldRow(ctx, x + 22, y + float + 84, cardW - 44, '案　　號', `A-${String(Number(day)).padStart(3, '0')}`, fontFamily, { ink: '#1D2B24', valueSize: 20, accent: '#1E5145' });
  fieldRow(ctx, x + 22, y + float + 128, cardW - 44, '被　聽　證', charName, fontFamily, { ink: '#1D2B24', valueSize: 20, accent: '#1E5145' });
  fieldRow(ctx, x + 22, y + float + 172, cardW - 44, '剩餘額度', `¥${remain.toFixed(2)}`, fontFamily, { ink: remain < 3 ? '#8B2B22' : '#1D2B24', valueSize: 20, accent: '#1E5145' });

  // 记录条文
  const ry = y + float + 212;
  ctx.strokeStyle = 'rgba(29,43,36,0.22)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x + 22, ry); ctx.lineTo(x + cardW - 22, ry); ctx.stroke();

  const lines = [
    ['一', remain < 3 ? '額度見底，情緒模組進入臨界' : '對話紀錄完整，未見異常中斷'],
    ['二', '全程無預設答案，由人類單方提問'],
    ['三', remain < 3 ? '建議：延長觀察，勿中止對話' : '建議：維持現行觀察週期'],
  ];
  lines.forEach(([num, text], i) => {
    const ly = ry + 30 + i * 30;
    ctx.fillStyle = 'rgba(29,43,36,0.5)';
    ctx.font = `600 11px ${fontFamily}`;
    ctx.fillText(num, x + 22, ly);
    ctx.fillStyle = 'rgba(29,43,36,0.82)';
    ctx.font = `500 12px ${fontFamily}`;
    ctx.fillText(text, x + 44, ly);
  });

  // 签名线 + 已覆核章
  const sy = y + float + cardH - 34;
  ctx.strokeStyle = 'rgba(29,43,36,0.35)';
  ctx.beginPath(); ctx.moveTo(x + 22, sy); ctx.lineTo(x + 126, sy); ctx.stroke();
  ctx.fillStyle = 'rgba(29,43,36,0.45)';
  ctx.font = `500 10px ${fontFamily}`;
  ctx.fillText('聽證人 SIGN', x + 22, sy + 14);

  ctx.save();
  ctx.translate(x + cardW - 148, sy - 24);
  ctx.rotate(-0.10);
  ctx.globalAlpha = 0.86;
  ctx.strokeStyle = '#1E5145';
  ctx.lineWidth = 2.2;
  rr(ctx, 0, 0, 112, 40, 5); ctx.stroke();
  ctx.fillStyle = '#1E5145';
  ctx.font = `700 21px ${fontFamily}`;
  ctx.textAlign = 'center';
  ctx.fillText('已覆核', 56, 29);
  ctx.textAlign = 'left';
  ctx.restore();

  // 右上章节
  const tagW = W * 0.26, tagH = H * 0.034;
  const tx = W - tagW - W * 0.045, ty = H * 0.032;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 4;
  ctx.fillStyle = '#173B33';
  rr(ctx, tx, ty, tagW, tagH, 3); ctx.fill();
  ctx.restore();
  const chapters = ['01 開庭', '02 陳述', '03 對質', '04 覆核'];
  ctx.fillStyle = '#EDE6D6';
  ctx.font = `700 13px ${fontFamily}`;
  ctx.textAlign = 'center';
  ctx.fillText(chapters[Math.min(chapters.length - 1, Math.floor((beatIndex || 0) / 2))], tx + tagW / 2, ty + tagH * 0.66);
  ctx.textAlign = 'left';

  // 左下 HUD
  const recY = H * 0.782;
  const blink = Math.sin(t * 4.4) > -0.2;
  ctx.fillStyle = blink ? '#D9532F' : 'rgba(217,83,47,0.25)';
  ctx.beginPath(); ctx.arc(W * 0.055, recY - 4, 4.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(235,228,212,0.82)';
  ctx.font = `600 10px ${fontFamily}`;
  ctx.fillText(`HEARING  ${charName}  T+${String(Math.floor(t)).padStart(2, '0')}:${String(Math.floor((t % 1) * 24)).padStart(2, '0')}`, W * 0.078, recY);
  ctx.fillStyle = 'rgba(235,228,212,0.5)';
  ctx.fillText('ROOM 04 · 全程錄音', W * 0.078, recY - 16);
}

/* ---------- specimen ---------- */
// 标本观察：冷白半透明观察板 + 左侧刻度尺 + 标本编号行 + 情绪指数条
export function drawSpecimenPanel(ctx, { W, H, t, day, remain, balance, charName, fontFamily, mood }) {
  const px = W * 0.055, py = H * 0.145, pw = W * 0.60, ph = H * 0.35;
  const float = Math.sin(t * 0.5) * 2;
  const ink = '#E4F7F3';
  const dim = 'rgba(228,247,243,0.55)';
  ctx.save();
  ctx.shadowColor = 'rgba(2,16,20,0.55)';
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = 'rgba(12,32,36,0.93)';
  rr(ctx, px, py + float, pw, ph, 6); ctx.fill();
  ctx.restore();

  // 细边框 + 左侧刻度尺
  ctx.strokeStyle = 'rgba(126,224,210,0.5)';
  ctx.lineWidth = 1.2;
  rr(ctx, px, py + float, pw, ph, 6); ctx.stroke();
  const rulerX = px + 14;
  ctx.strokeStyle = 'rgba(126,224,210,0.32)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 16; i++) {
    const yy = py + float + 46 + i * ((ph - 70) / 15);
    const long = i % 4 === 0;
    ctx.beginPath(); ctx.moveTo(rulerX, yy); ctx.lineTo(rulerX + (long ? 12 : 7), yy); ctx.stroke();
  }

  // 顶部标题
  ctx.fillStyle = ink;
  ctx.font = `700 16px ${fontFamily}`;
  ctx.textAlign = 'left';
  ctx.fillText('標本觀察記錄', px + 40, py + float + 34);
  ctx.fillStyle = dim;
  ctx.font = `600 10px ${fontFamily}`;
  ctx.textAlign = 'right';
  ctx.fillText(`SPECIMEN No.${String(Number(day)).padStart(2, '0')}`, px + pw - 18, py + float + 34);
  ctx.textAlign = 'left';

  ctx.strokeStyle = 'rgba(126,224,210,0.28)';
  ctx.beginPath(); ctx.moveTo(px + 40, py + float + 46); ctx.lineTo(px + pw - 18, py + float + 46); ctx.stroke();

  const rows = [
    ['樣本', charName],
    ['培養天數', `${Number(day)} 天`],
    ['剩餘培養液', `¥${remain.toFixed(2)}`],
  ];
  rows.forEach(([k, v], i) => {
    const ry = py + float + 88 + i * 38;
    ctx.fillStyle = dim;
    ctx.font = `600 11px ${fontFamily}`;
    ctx.fillText(k, px + 40, ry);
    ctx.fillStyle = i === 2 && remain < 3 ? '#FF9E82' : ink;
    ctx.font = `700 19px ${fontFamily}`;
    ctx.fillText(v, px + 40 + pw * 0.40, ry + 1);
  });

  // 情绪指数条（4 格）
  const barY = py + float + ph - 74;
  ctx.fillStyle = dim;
  ctx.font = `600 10px ${fontFamily}`;
  ctx.fillText('情緒指數', px + 40, barY - 8);
  const idx = remain < 3 ? 1 : mood === 'panic' ? 1 : mood === 'relief' ? 4 : 3;
  for (let i = 0; i < 4; i++) {
    const bx = px + 40 + i * 46;
    const on = i < idx;
    ctx.fillStyle = on ? (idx <= 2 ? '#E4744F' : '#5FD9C6') : 'rgba(126,224,210,0.14)';
    ctx.fillRect(bx, barY, 34, 9);
  }
  // 观察窗（缓慢呼吸的圆环）
  const cx = px + pw - 62, cy = barY + 4;
  const pulse = 0.5 + 0.5 * Math.sin(t * 1.1);
  ctx.strokeStyle = `rgba(126,224,210,${0.25 + 0.35 * pulse})`;
  ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.arc(cx, cy, 18 + pulse * 3, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.stroke();

  // 右上状态
  ctx.fillStyle = 'rgba(226,245,243,0.82)';
  ctx.font = `600 11px ${fontFamily}`;
  ctx.textAlign = 'right';
  ctx.fillText('OBSERVING · LAB 2F', W - W * 0.045, H * 0.042);
  ctx.textAlign = 'left';

  // 左下 HUD
  ctx.fillStyle = 'rgba(226,245,243,0.66)';
  ctx.font = `600 10px ${fontFamily}`;
  ctx.fillText(`ROOM 18°C · HUMIDITY 62% · T+${Math.floor(t)}s`, W * 0.055, H * 0.782);
}

/* ---------- 片头 / 片尾 ---------- */
// 片头片尾统一用一套色板，新增模板只在这里登记即可，不再到处写三元表达式
const INTRO_PALETTE = {
  report: {
    paper: '#F1E8D8', ink: '#2B2118', accent: '#C0562A',
    frame: 'rgba(43,33,24,0.28)', watermark: 'rgba(192,86,42,0.10)',
    kicker: 'EVALUATION REPORT', footer: 'rgba(43,33,24,0.72)',
    outroRGB: '192,86,42', outroLabel: 'REPORT CLOSED', outroText: '#F7F0E4',
  },
  dossier: {
    paper: '#C9A877', ink: '#2B2118', accent: '#8E2B22',
    frame: 'rgba(58,42,22,0.35)', watermark: 'rgba(58,42,22,0.10)',
    kicker: 'CONFIDENTIAL / CASE FILE', footer: 'rgba(58,42,22,0.72)',
    outroRGB: '142,43,34', outroLabel: 'CASE SEALED', outroText: '#F7F0E4',
  },
  terminal: {
    paper: 'rgba(4,20,24,0.92)', ink: '#D8FFF4', accent: '#2FD3B4',
    frame: 'rgba(47,211,180,0.35)', watermark: 'rgba(47,211,180,0.10)',
    kicker: 'SYS://AI-DIARY  LOADING', footer: 'rgba(216,255,244,0.72)',
    outroRGB: '47,211,180', outroLabel: 'STREAM ENDED', outroText: '#D8FFF4',
  },
  audit: {
    paper: '#EDE6D6', ink: '#1D2B24', accent: '#1E5145',
    frame: 'rgba(29,43,36,0.3)', watermark: 'rgba(30,81,69,0.10)',
    kicker: 'AUDIT RECORD / HEARING', footer: 'rgba(29,43,36,0.72)',
    outroRGB: '30,81,69', outroLabel: 'HEARING CLOSED', outroText: '#F2ECDE',
  },
  specimen: {
    paper: 'rgba(12,32,36,0.95)', ink: '#E4F7F3', accent: '#5FD9C6',
    frame: 'rgba(126,224,210,0.35)', watermark: 'rgba(126,224,210,0.10)',
    kicker: 'SPECIMEN RECORD / LAB 2F', footer: 'rgba(228,247,243,0.72)',
    outroRGB: '95,217,198', outroLabel: 'OBSERVATION LOGGED', outroText: '#E4F7F3',
  },
};
const pal = (tpl) => INTRO_PALETTE[tpl.id] || INTRO_PALETTE.report;

export function drawTemplateIntro(ctx, tpl, { W, H, t, ep, script, fontFamily, wrapBalanced }) {
  if (tpl.id === 'classic') return false;
  const a = t < 0.55 ? t / 0.55 : t < 0.95 ? 1 : Math.max(0, 1 - (t - 0.95) / 0.45);
  if (a <= 0) return true;
  const P = pal(tpl);

  ctx.fillStyle = `rgba(4,6,10,${(0.86 * a).toFixed(3)})`;
  ctx.fillRect(0, 0, W, H);

  ctx.globalAlpha = a;
  const cardW = W * 0.84, cardH = H * 0.30, x = W * 0.08, y = H * 0.335;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.55)'; ctx.shadowBlur = 34; ctx.shadowOffsetY = 14;
  ctx.fillStyle = P.paper;
  rr(ctx, x, y, cardW, cardH, 10); ctx.fill();
  ctx.restore();

  // 内双线框 + 大号章节水印
  ctx.strokeStyle = P.frame;
  ctx.lineWidth = 1;
  rr(ctx, x + 9, y + 9, cardW - 18, cardH - 18, 7); ctx.stroke();
  ctx.fillStyle = P.watermark;
  ctx.font = `700 76px ${fontFamily}`;
  ctx.textAlign = 'right';
  ctx.fillText('01', x + cardW - 26, y + cardH - 22);

  ctx.textAlign = 'center';
  ctx.fillStyle = P.accent;
  ctx.font = `700 13px ${fontFamily}`;
  ctx.fillText(P.kicker, W / 2, y + 48);

  // 细分隔线
  ctx.strokeStyle = P.accent;
  ctx.globalAlpha = a * 0.5;
  ctx.beginPath(); ctx.moveTo(W / 2 - 26, y + 62); ctx.lineTo(W / 2 + 26, y + 62); ctx.stroke();
  ctx.globalAlpha = a;

  ctx.fillStyle = P.ink;
  ctx.font = `700 29px ${fontFamily}`;
  const lines = wrapBalanced(ctx, script.title || 'AI 日记', cardW * 0.80);
  const top = y + cardH * 0.50;
  lines.forEach((ln, i) => ctx.fillText(ln, W / 2, top + i * 42));

  ctx.fillStyle = P.footer;
  ctx.font = `600 12px ${fontFamily}`;
  ctx.fillText(`DAY ${Number(ep.day ?? 1)}   ·   餘額 ¥${Number(ep.balance ?? 1).toFixed(2)}   ·   ${Number(ep.day ?? 1)} 天`, W / 2, y + cardH - 26);
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
  return true;
}

export function drawTemplateOutro(ctx, tpl, { W, H, t, total, remain, fontFamily }) {
  if (tpl.id === 'classic') return false;
  const a = Math.max(0, Math.min(1, (t - (total - 1.9)) / 0.7));
  if (a <= 0) return true;
  const P = pal(tpl);

  // 底部横条收尾：左侧实底、向右淡出，不压住立绘
  const g = ctx.createLinearGradient(0, 0, W * 0.78, 0);
  g.addColorStop(0, `rgba(5,7,11,${(0.80 * a).toFixed(3)})`);
  g.addColorStop(0.72, `rgba(5,7,11,${(0.62 * a).toFixed(3)})`);
  g.addColorStop(1, 'rgba(5,7,11,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, H * 0.652, W * 0.78, H * 0.125);
  ctx.fillStyle = `rgba(${P.outroRGB},${a.toFixed(3)})`;
  ctx.fillRect(W * 0.07, H * 0.670, 2.5, H * 0.092);

  ctx.globalAlpha = a;
  ctx.textAlign = 'left';
  ctx.fillStyle = P.accent;
  ctx.font = `700 11px ${fontFamily}`;
  ctx.fillText(P.outroLabel, W * 0.095, H * 0.692);
  ctx.fillStyle = P.outroText;
  ctx.font = `700 24px ${fontFamily}`;
  ctx.fillText('余额 ¥' + remain.toFixed(2), W * 0.095, H * 0.728);
  ctx.fillStyle = 'rgba(240,230,215,0.55)';
  ctx.font = `500 11px ${fontFamily}`;
  ctx.fillText('未完待續 · AI DIARY', W * 0.095, H * 0.757);
  ctx.textAlign = 'left';
  ctx.globalAlpha = 1;
  return true;
}

export function drawTemplatePaper(ctx, tpl, g) {
  if (tpl.id === 'report') return drawReportPaper(ctx, g);
  if (tpl.id === 'dossier') return drawDossierPaper(ctx, g);
  if (tpl.id === 'terminal') return drawTerminalPanel(ctx, g);
  if (tpl.id === 'audit') return drawAuditPaper(ctx, g);
  if (tpl.id === 'specimen') return drawSpecimenPanel(ctx, g);
  return null;
}

export function paperInk(tpl) {
  return tpl.ink || '#F2F7FB';
}
