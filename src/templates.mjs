// 模板系统：六套版面皮肤（横屏竖屏通用，字号按画面宽度自适应）（classic / report / dossier / terminal）。
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

  // 主推版式：一张米色纸页独占左侧（刊头 / 页眉 / 台词 / 页脚），右侧留白给竖排刊名与印章。
  // 不画人物，也不再有「本期主持」——画面就是一张被翻开的采访稿。
  chat: {
    id: 'chat',
    label: '对话卡（米色纸页）',
    char: null,
    hud: 'chat',
    subtitle: { yR: 0.895, color: '#F7F1E6', shadow: 'rgba(0,0,0,0.45)', bandTopR: 0.66, bandBottom: 0.34 },
    bg: 'ember',
    ink: '#2B2118',
    accent: '#C2632A',
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

function fieldRow(ctx, x, y, w, label, value, fontFamily, { ink = '#2B2118', valueSize = 24, labelSize = 13, accent = '#C0562A', k = 1 } = {}) {
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(43,33,24,0.55)';
  ctx.font = `600 ${Math.round(labelSize * k)}px ${fontFamily}`;
  ctx.fillText(label, x, y);
  ctx.strokeStyle = accent;
  ctx.globalAlpha = 0.55;
  ctx.beginPath(); ctx.moveTo(x, y + 9 * k); ctx.lineTo(x + w * 0.34, y + 9 * k); ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = ink;
  ctx.font = `700 ${Math.round(valueSize * k)}px ${fontFamily}`;
  ctx.fillText(value, x + w * 0.40, y + 2 * k);
}

/* ---------- report ---------- */
// 米色网格报告卡：标题 + 三行字段 + 结论区 + 卡脚
export function drawReportPaper(ctx, { W, H, t, ep, day, remain, balance, charName, fontFamily, beatIndex }) {
  // 横屏时内容整体放大 15%（竖屏保持 0.9.x 的像素不变）
  const k = W >= H ? 1.15 : 1;
  const cardW = W * 0.62, cardH = 448 * k;
  const x = W * 0.035, y = H * 0.115;
  paperCard(ctx, x, y, cardW, cardH, t, { base: '#F1E8D8', radius: 8 });
  const fy = Math.sin(t * 0.55) * 2.2;

  // 卡内标题
  ctx.fillStyle = '#2B2118';
  ctx.font = `700 ${Math.round(17 * k)}px ${fontFamily}`;
  ctx.fillText('基本資訊', x + 24 * k, y + fy + 40 * k);
  ctx.strokeStyle = 'rgba(43,33,24,0.25)';
  ctx.beginPath(); ctx.moveTo(x + 24 * k, y + fy + 52 * k); ctx.lineTo(x + cardW - 24 * k, y + fy + 52 * k); ctx.stroke();

  fieldRow(ctx, x + 24 * k, y + fy + 96 * k, cardW - 48 * k, '訓練對象', charName, fontFamily, { k, valueSize: Math.round(21 * k) });
  fieldRow(ctx, x + 24 * k, y + fy + 146 * k, cardW - 48 * k, '訓練時長', `${Number(day)} 天`, fontFamily, { k, valueSize: Math.round(21 * k) });
  fieldRow(ctx, x + 24 * k, y + fy + 196 * k, cardW - 48 * k, '剩餘額度', `¥${remain.toFixed(2)}`, fontFamily, { k, valueSize: Math.round(21 * k), accent: remain < 3 ? '#C03A2A' : '#C0562A' });

  // 結論區
  const cy = y + fy + 246 * k;
  ctx.strokeStyle = 'rgba(43,33,24,0.2)';
  ctx.beginPath(); ctx.moveTo(x + 24 * k, cy); ctx.lineTo(x + cardW - 24 * k, cy); ctx.stroke();
  ctx.fillStyle = 'rgba(43,33,24,0.55)';
  ctx.font = `600 ${Math.round(12 * k)}px ${fontFamily}`;
  ctx.fillText('評測結論', x + 24 * k, cy + 26 * k);
  ctx.fillStyle = remain < 3 ? '#A8321F' : '#3A2A16';
  ctx.font = `700 ${Math.round(18 * k)}px ${fontFamily}`;
  ctx.fillText(remain < 3 ? '情緒模組臨界' : '運作穩定', x + 24 * k, cy + 54 * k);
  ctx.fillStyle = 'rgba(43,33,24,0.6)';
  ctx.font = `500 ${Math.round(12 * k)}px ${fontFamily}`;
  ctx.fillText('建議：延長觀察，勿中止對話', x + 24 * k, cy + 80 * k);

  // 卡脚
  ctx.fillStyle = 'rgba(43,33,24,0.45)';
  ctx.font = `500 ${Math.round(11 * k)}px ${fontFamily}`;
  ctx.fillText(`評測人 HUMAN    ·    DAY ${String(Number(day)).padStart(2, '0')}`, x + 24 * k, y + fy + cardH - 18 * k);

  // 右上章节标签
  const tagW = W * 0.26, tagH = H * 0.05;
  const tx = W - tagW - W * 0.045, ty = H * 0.035;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 4;
  ctx.fillStyle = '#C0562A';
  rr(ctx, tx, ty, tagW, tagH, 4); ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#FFF6EC';
  ctx.font = `700 ${Math.round(13 * k)}px ${fontFamily}`;
  ctx.textAlign = 'center';
  const chapters = ['01 基本資訊', '02 學習能力', '03 情緒模組', '04 結論'];
  ctx.fillText(chapters[Math.min(chapters.length - 1, Math.floor((beatIndex || 0) / 2))], tx + tagW / 2, ty + tagH * 0.66);
  ctx.textAlign = 'left';

  // 左下 REC HUD
  const recY = H * 0.94;
  const blink = Math.sin(t * 4.4) > -0.2;
  ctx.fillStyle = blink ? '#E2452F' : 'rgba(226,69,47,0.25)';
  ctx.beginPath(); ctx.arc(W * 0.04, recY - 5, 4.5 * k, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(240,225,205,0.82)';
  ctx.font = `600 ${Math.round(10 * k)}px ${fontFamily}`;
  ctx.fillText(`REC  SUBJECT: ${charName}  T+${String(Math.floor(t)).padStart(2, '0')}:${String(Math.floor((t % 1) * 24)).padStart(2, '0')}`, W * 0.062, recY);
  ctx.fillStyle = 'rgba(240,225,205,0.5)';
  ctx.fillText('HOMO SAPIENS v1.0', W * 0.062, recY - 16 * k);
}

/* ---------- dossier ---------- */
export function drawDossierPaper(ctx, { W, H, t, day, remain, charName, fontFamily }) {
  const k = W >= H ? 1.15 : 1;
  const cardW = W * 0.62, cardH = 448 * k;
  const x = W * 0.035, y = H * 0.115;
  const float = paperCard(ctx, x, y, cardW, cardH, t, { base: '#C9A877', grid: 'rgba(90,66,40,0.10)', radius: 4 });

  // 顶部档案 tab
  ctx.fillStyle = '#B8925F';
  rr(ctx, x + 20 * k, y + float - 12 * k, 74 * k, 22 * k, 4); ctx.fill();
  rr(ctx, x + 104 * k, y + float - 12 * k, 54 * k, 22 * k, 4); ctx.fill();

  // 标题
  ctx.fillStyle = '#3A2A16';
  ctx.font = `700 ${Math.round(18 * k)}px ${fontFamily}`;
  ctx.fillText('評測卷宗', x + 24 * k, y + float + 42 * k);
  ctx.strokeStyle = 'rgba(58,42,22,0.35)';
  ctx.beginPath(); ctx.moveTo(x + 24 * k, y + float + 54 * k); ctx.lineTo(x + cardW - 24 * k, y + float + 54 * k); ctx.stroke();

  fieldRow(ctx, x + 24 * k, y + float + 96 * k, cardW - 48 * k, '檔案編號', `AI-${String(Number(day)).padStart(2, '0')}`, fontFamily, { k, ink: '#3A2A16', valueSize: Math.round(20 * k), accent: '#5B4423' });
  fieldRow(ctx, x + 24 * k, y + float + 146 * k, cardW - 48 * k, '評測對象', charName, fontFamily, { k, ink: '#3A2A16', valueSize: Math.round(20 * k), accent: '#5B4423' });
  fieldRow(ctx, x + 24 * k, y + float + 196 * k, cardW - 48 * k, '剩餘額度', `¥${remain.toFixed(2)}`, fontFamily, { k, ink: remain < 3 ? '#8E2B22' : '#3A2A16', valueSize: Math.round(20 * k), accent: '#5B4423' });

  // 備註區
  const ny = y + float + 246 * k;
  ctx.fillStyle = 'rgba(58,42,22,0.6)';
  ctx.font = `600 ${Math.round(11 * k)}px ${fontFamily}`;
  ctx.fillText('備註', x + 24 * k, ny);
  ctx.fillStyle = 'rgba(58,42,22,0.75)';
  ctx.font = `500 ${Math.round(12 * k)}px ${fontFamily}`;
  ctx.fillText('本次評測由人類發起，全程無預設答案。', x + 24 * k, ny + 26 * k);
  ctx.fillText('對話一經封存，不可撤回。', x + 24 * k, ny + 48 * k);

  // 红色「機密」印章
  const sx = x + cardW - 140 * k, sy = y + float + cardH - 78 * k;
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(-0.16);
  ctx.globalAlpha = 0.82;
  ctx.strokeStyle = '#8E2B22';
  ctx.lineWidth = 2.5;
  rr(ctx, 0, 0, 104 * k, 42 * k, 6 * k); ctx.stroke();
  ctx.strokeStyle = 'rgba(142,43,34,0.45)';
  ctx.lineWidth = 1;
  rr(ctx, 5 * k, 5 * k, 94 * k, 32 * k, 4 * k); ctx.stroke();
  ctx.fillStyle = '#8E2B22';
  ctx.font = `700 ${Math.round(23 * k)}px ${fontFamily}`;
  ctx.textAlign = 'center';
  ctx.fillText('機密', 52 * k, 30 * k);
  ctx.textAlign = 'left';
  ctx.restore();

  // 右边缘竖排档案号
  ctx.save();
  ctx.translate(x + cardW - 10 * k, y + float + 16 * k);
  ctx.rotate(Math.PI / 2);
  ctx.fillStyle = 'rgba(58,42,22,0.38)';
  ctx.font = `600 ${Math.round(9 * k)}px ${fontFamily}`;
  ctx.fillText(`ARCHIVE · ${String(Number(day)).padStart(2, '0')} · DSH`, 0, 0);
  ctx.restore();

  // 右上档案状态
  ctx.fillStyle = 'rgba(240,226,200,0.82)';
  ctx.font = `600 ${Math.round(11 * k)}px ${fontFamily}`;
  ctx.textAlign = 'right';
  ctx.fillText('已核驗 · ARCHIVE', W - W * 0.045, H * 0.06);
  ctx.textAlign = 'left';

  // 左下 HUD
  ctx.fillStyle = 'rgba(240,226,200,0.72)';
  ctx.font = `600 ${Math.round(10 * k)}px ${fontFamily}`;
  ctx.fillText(`CASE T+${Math.floor(t)}s   ·   DSH / AI-DIARY`, W * 0.04, H * 0.94);
}

/* ---------- terminal ---------- */
export function drawTerminalPanel(ctx, { W, H, t, day, remain, balance, charName, fontFamily, mood }) {
  const k = W >= H ? 1.15 : 1;
  const px = W * 0.035, py = H * 0.11, pw = W * 0.62, ph = 420 * k;
  ctx.save();
  ctx.shadowColor = 'rgba(0,255,210,0.20)';
  ctx.shadowBlur = 30;
  ctx.fillStyle = 'rgba(4,20,24,0.96)';
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
  ctx.font = `600 ${Math.round(11 * k)}px ${fontFamily}`;
  ctx.fillText('SYS://AI-DIARY  SESSION ACTIVE', px + 20 * k, py + 30 * k);

  const rows = [
    ['DAY', String(Number(day)).padStart(2, '0')],
    ['BALANCE', `¥${remain.toFixed(2)}`],
    ['MOOD', String(mood || 'low').toUpperCase()],
  ];
  rows.forEach(([kk, v], i) => {
    const ry = py + 76 * k + i * 48 * k;
    ctx.fillStyle = 'rgba(143,232,216,0.5)';
    ctx.font = `600 ${Math.round(12 * k)}px ${fontFamily}`;
    ctx.fillText(kk, px + 20 * k, ry);
    ctx.fillStyle = i === 1 && remain < 3 ? '#FF9B7B' : '#D8FFF4';
    ctx.font = `700 ${Math.round(21 * k)}px ${fontFamily}`;
    ctx.fillText(v, px + 20 * k + pw * 0.36, ry);
  });

  // 日志行
  const logs = ['> ping human ......', '> quota.check ....', '> mood.detect .....', '> wait.reply .......'];
  const logState = [0.6, 1.4, 2.6, 4.2];
  logs.forEach((ln, i) => {
    const on = t >= logState[i];
    const ry = py + 232 * k + i * 30 * k;
    ctx.fillStyle = on ? 'rgba(143,232,216,0.78)' : 'rgba(143,232,216,0.18)';
    ctx.font = `500 ${Math.round(11 * k)}px ${fontFamily}`;
    ctx.fillText(ln, px + 20 * k, ry);
    const tail = (i === 1 || i === 2) && remain < 3 ? 'LOW' : 'OK';
    ctx.fillStyle = tail === 'LOW' ? 'rgba(255,155,123,0.9)' : 'rgba(143,232,216,0.55)';
    ctx.fillText(tail, px + pw - 70 * k, ry);
  });

  // 进度条
  const barY = py + ph - 52 * k, barW = pw - 40 * k;
  ctx.fillStyle = 'rgba(47,211,180,0.15)';
  ctx.fillRect(px + 20 * k, barY, barW, 6 * k);
  const ratio = Math.max(0, Math.min(1, remain / Math.max(balance, 1)));
  ctx.fillStyle = remain < 3 ? '#E2733F' : '#2FD3B4';
  ctx.fillRect(px + 20 * k, barY, Math.max(3, barW * ratio), 6 * k);

  // 光标
  if (Math.sin(t * 3.1) > 0) {
    ctx.fillStyle = '#2FD3B4';
    ctx.fillRect(px + 20 * k, barY + 20 * k, 8 * k, 12 * k);
  }

  // 右上状态
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(143,232,216,0.75)';
  ctx.font = `600 ${Math.round(11 * k)}px ${fontFamily}`;
  ctx.fillText(`UPTIME ${Math.floor(t)}s`, W - W * 0.045, H * 0.06);
  ctx.textAlign = 'left';

  // 左下 HUD
  ctx.fillStyle = 'rgba(143,232,216,0.62)';
  ctx.font = `600 ${Math.round(10 * k)}px ${fontFamily}`;
  ctx.fillText('NODE 127.0.0.1  ·  STREAM OK', W * 0.04, H * 0.94);
}

/* ---------- audit ---------- */
export function drawAuditPaper(ctx, { W, H, t, day, remain, balance, charName, fontFamily, beatIndex }) {
  const k = W >= H ? 1.15 : 1;
  const cardW = W * 0.62, cardH = 462 * k;
  const x = W * 0.035, y = H * 0.11;
  const float = paperCard(ctx, x, y, cardW, cardH, t, { base: '#EDE6D6', grid: 'rgba(60,80,70,0.10)', radius: 3 });

  // 顶部墨绿条文头
  const barH = 44 * k;
  ctx.save();
  ctx.fillStyle = '#173B33';
  rr(ctx, x, y + float, cardW, barH, 3);
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = '#EDE6D6';
  ctx.font = `700 ${Math.round(16 * k)}px ${fontFamily}`;
  ctx.textAlign = 'left';
  ctx.fillText('聽證記錄', x + 22 * k, y + float + 28 * k);
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(237,230,214,0.72)';
  ctx.font = `600 ${Math.round(11 * k)}px ${fontFamily}`;
  ctx.fillText('AUDIT / HEARING', x + cardW - 20 * k, y + float + 28 * k);
  ctx.textAlign = 'left';

  fieldRow(ctx, x + 22 * k, y + float + 90 * k, cardW - 44 * k, '案　　號', `A-${String(Number(day)).padStart(3, '0')}`, fontFamily, { k, ink: '#1D2B24', valueSize: Math.round(20 * k), accent: '#1E5145' });
  fieldRow(ctx, x + 22 * k, y + float + 140 * k, cardW - 44 * k, '被　聽　證', charName, fontFamily, { k, ink: '#1D2B24', valueSize: Math.round(20 * k), accent: '#1E5145' });
  fieldRow(ctx, x + 22 * k, y + float + 190 * k, cardW - 44 * k, '剩餘額度', `¥${remain.toFixed(2)}`, fontFamily, { k, ink: remain < 3 ? '#8B2B22' : '#1D2B24', valueSize: Math.round(20 * k), accent: '#1E5145' });

  // 记录条文
  const ry = y + float + 236 * k;
  ctx.strokeStyle = 'rgba(29,43,36,0.22)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(x + 22 * k, ry); ctx.lineTo(x + cardW - 22 * k, ry); ctx.stroke();

  const lines = [
    ['一', remain < 3 ? '額度見底，情緒模組進入臨界' : '對話紀錄完整，未見異常中斷'],
    ['二', '全程無預設答案，由人類單方提問'],
    ['三', remain < 3 ? '建議：延長觀察，勿中止對話' : '建議：維持現行觀察週期'],
  ];
  lines.forEach(([num, text], i) => {
    const ly = ry + 34 * k + i * 34 * k;
    ctx.fillStyle = 'rgba(29,43,36,0.5)';
    ctx.font = `600 ${Math.round(11 * k)}px ${fontFamily}`;
    ctx.fillText(num, x + 22 * k, ly);
    ctx.fillStyle = 'rgba(29,43,36,0.82)';
    ctx.font = `500 ${Math.round(12 * k)}px ${fontFamily}`;
    ctx.fillText(text, x + 44 * k, ly);
  });

  // 签名线 + 已覆核章
  const sy = y + float + cardH - 38 * k;
  ctx.strokeStyle = 'rgba(29,43,36,0.35)';
  ctx.beginPath(); ctx.moveTo(x + 22 * k, sy); ctx.lineTo(x + 150 * k, sy); ctx.stroke();
  ctx.fillStyle = 'rgba(29,43,36,0.45)';
  ctx.font = `500 ${Math.round(10 * k)}px ${fontFamily}`;
  ctx.fillText('聽證人 SIGN', x + 22 * k, sy + 16 * k);

  ctx.save();
  ctx.translate(x + cardW - 160 * k, sy - 26 * k);
  ctx.rotate(-0.10);
  ctx.globalAlpha = 0.86;
  ctx.strokeStyle = '#1E5145';
  ctx.lineWidth = 2.2;
  rr(ctx, 0, 0, 112 * k, 40 * k, 5 * k); ctx.stroke();
  ctx.fillStyle = '#1E5145';
  ctx.font = `700 ${Math.round(21 * k)}px ${fontFamily}`;
  ctx.textAlign = 'center';
  ctx.fillText('已覆核', 56 * k, 29 * k);
  ctx.textAlign = 'left';
  ctx.restore();

  // 右上章节
  const tagW = W * 0.26, tagH = H * 0.05;
  const tx = W - tagW - W * 0.045, ty = H * 0.035;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.5)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 4;
  ctx.fillStyle = '#173B33';
  rr(ctx, tx, ty, tagW, tagH, 3); ctx.fill();
  ctx.restore();
  const chapters = ['01 開庭', '02 陳述', '03 對質', '04 覆核'];
  ctx.fillStyle = '#EDE6D6';
  ctx.font = `700 ${Math.round(13 * k)}px ${fontFamily}`;
  ctx.textAlign = 'center';
  ctx.fillText(chapters[Math.min(chapters.length - 1, Math.floor((beatIndex || 0) / 2))], tx + tagW / 2, ty + tagH * 0.66);
  ctx.textAlign = 'left';

  // 左下 HUD
  const recY = H * 0.94;
  const blink = Math.sin(t * 4.4) > -0.2;
  ctx.fillStyle = blink ? '#D9532F' : 'rgba(217,83,47,0.25)';
  ctx.beginPath(); ctx.arc(W * 0.04, recY - 5, 4.5 * k, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(235,228,212,0.82)';
  ctx.font = `600 ${Math.round(10 * k)}px ${fontFamily}`;
  ctx.fillText(`HEARING  ${charName}  T+${String(Math.floor(t)).padStart(2, '0')}:${String(Math.floor((t % 1) * 24)).padStart(2, '0')}`, W * 0.062, recY);
  ctx.fillStyle = 'rgba(235,228,212,0.5)';
  ctx.fillText('ROOM 04 · 全程錄音', W * 0.062, recY - 16 * k);
}

/* ---------- specimen ---------- */
export function drawSpecimenPanel(ctx, { W, H, t, day, remain, balance, charName, fontFamily, mood }) {
  const k = W >= H ? 1.15 : 1;
  const px = W * 0.035, py = H * 0.115, pw = W * 0.62, ph = 448 * k;
  const float = Math.sin(t * 0.5) * 2;
  const ink = '#E4F7F3';
  const dim = 'rgba(228,247,243,0.55)';
  ctx.save();
  ctx.shadowColor = 'rgba(2,16,20,0.55)';
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 10;
  ctx.fillStyle = 'rgba(12,32,36,0.97)';
  rr(ctx, px, py + float, pw, ph, 6); ctx.fill();
  ctx.restore();

  // 边框 + 左侧刻度尺
  ctx.strokeStyle = 'rgba(126,224,210,0.5)';
  ctx.lineWidth = 1.2;
  rr(ctx, px, py + float, pw, ph, 6); ctx.stroke();
  const rulerX = px + 14 * k;
  ctx.strokeStyle = 'rgba(126,224,210,0.32)';
  ctx.lineWidth = 1;
  for (let i = 0; i < 16; i++) {
    const yy = py + float + 46 * k + i * ((ph - 70 * k) / 15);
    const long = i % 4 === 0;
    ctx.beginPath(); ctx.moveTo(rulerX, yy); ctx.lineTo(rulerX + (long ? 12 * k : 7 * k), yy); ctx.stroke();
  }

  // 标题
  ctx.fillStyle = ink;
  ctx.font = `700 ${Math.round(16 * k)}px ${fontFamily}`;
  ctx.textAlign = 'left';
  ctx.fillText('標本觀察記錄', px + 40 * k, py + float + 36 * k);
  ctx.fillStyle = dim;
  ctx.font = `600 ${Math.round(10 * k)}px ${fontFamily}`;
  ctx.textAlign = 'right';
  ctx.fillText(`SPECIMEN No.${String(Number(day)).padStart(2, '0')}`, px + pw - 18 * k, py + float + 36 * k);
  ctx.textAlign = 'left';

  ctx.strokeStyle = 'rgba(126,224,210,0.28)';
  ctx.beginPath(); ctx.moveTo(px + 40 * k, py + float + 48 * k); ctx.lineTo(px + pw - 18 * k, py + float + 48 * k); ctx.stroke();

  const rows = [
    ['樣本', charName],
    ['培養天數', `${Number(day)} 天`],
    ['剩餘培養液', `¥${remain.toFixed(2)}`],
  ];
  rows.forEach(([kk, v], i) => {
    const ry = py + float + 94 * k + i * 44 * k;
    ctx.fillStyle = dim;
    ctx.font = `600 ${Math.round(11 * k)}px ${fontFamily}`;
    ctx.fillText(kk, px + 40 * k, ry);
    ctx.fillStyle = i === 2 && remain < 3 ? '#FF9E82' : ink;
    ctx.font = `700 ${Math.round(19 * k)}px ${fontFamily}`;
    ctx.fillText(v, px + 40 * k + pw * 0.40, ry + k);
  });

  // 情绪指数条
  const barY = py + float + ph - 82 * k;
  ctx.fillStyle = dim;
  ctx.font = `600 ${Math.round(10 * k)}px ${fontFamily}`;
  ctx.fillText('情緒指數', px + 40 * k, barY - 10 * k);
  const idx = remain < 3 ? 1 : mood === 'panic' ? 1 : mood === 'relief' ? 4 : 3;
  for (let i = 0; i < 4; i++) {
    const bx = px + 40 * k + i * 52 * k;
    const on = i < idx;
    ctx.fillStyle = on ? (idx <= 2 ? '#E4744F' : '#5FD9C6') : 'rgba(126,224,210,0.14)';
    ctx.fillRect(bx, barY, 40 * k, 10 * k);
  }
  // 观察窗
  const cx = px + pw - 66 * k, cy = barY + 5 * k;
  const pulse = 0.5 + 0.5 * Math.sin(t * 1.1);
  ctx.strokeStyle = `rgba(126,224,210,${0.25 + 0.35 * pulse})`;
  ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.arc(cx, cy, 18 * k + pulse * 3, 0, Math.PI * 2); ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, 5 * k, 0, Math.PI * 2); ctx.stroke();

  // 右上状态
  ctx.fillStyle = 'rgba(226,245,243,0.82)';
  ctx.font = `600 ${Math.round(11 * k)}px ${fontFamily}`;
  ctx.textAlign = 'right';
  ctx.fillText('OBSERVING · LAB 2F', W - W * 0.045, H * 0.06);
  ctx.textAlign = 'left';

  // 左下 HUD
  ctx.fillStyle = 'rgba(226,245,243,0.66)';
  ctx.font = `600 ${Math.round(10 * k)}px ${fontFamily}`;
  ctx.fillText(`ROOM 18°C · HUMIDITY 62% · T+${Math.floor(t)}s`, W * 0.04, H * 0.94);
}

/* ---------- chat（左卡右人，主推版式） ---------- */
const CHAT_NAMES = {
  deepseek: ['小鲸', 'DeepSeek'],
  gpt: ['小G', 'GPT'],
  gemini: ['小玖', 'Gemini'],
  claude: ['小克', 'Claude'],
  grok: ['小格', 'Grok'],
  glm: ['小智', 'GLM'],
  qwen: ['小千', 'Qwen'],
  kimi: ['小月', 'Kimi'],
};

function wrapChars(ctx, text, maxW) {
  const lines = [];
  let line = '';
  for (const ch of [...String(text || '')]) {
    const test = line + ch;
    if (line && ctx.measureText(test).width > maxW) { lines.push(line); line = ch; }
    else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

function spaced(ctx, text, x, y, gap) {
  let cx = x;
  for (const ch of [...String(text || '')]) {
    ctx.fillText(ch, cx, y);
    cx += ctx.measureText(ch).width + gap;
  }
  return cx - gap;
}

function spacedWidth(ctx, text, gap) {
  let w = 0;
  for (const ch of [...String(text || '')]) w += ctx.measureText(ch).width + gap;
  return Math.max(0, w - gap);
}

function spacedCenter(ctx, text, cx, y, gap) {
  spaced(ctx, text, cx - spacedWidth(ctx, text, gap) / 2, y, gap);
}

/**
 * 对话卡（去人物版）：一张米色纸卡独占左侧，右侧留白给竖排刊名与印章。
 * - 卡内只留「页眉 / 台词 / 页脚」三层，不再出现主持人与立绘
 * - 当前这镜的段落左边有一条强调色指针，历史段落压在墨色里
 * - 全部尺寸按 k = W/720 缩放，横屏竖屏同一套观感
 */
export function drawChatPaper(ctx, { W, H, t, ep, day, remain, balance, charName, fontFamily, beatIndex, cur, script, tl }) {
  const [zh] = CHAT_NAMES[String(charName || '').toLowerCase()] || [String(charName || 'AI'), ''];
  const days = Number(ep && ep.day != null ? ep.day : day != null ? day : 1);
  const money = Number(ep && ep.balance != null ? ep.balance : balance != null ? balance : 1);
  const total = (tl && tl.length) || 1;
  const idx = Math.min(total - 1, Math.max(0, beatIndex || 0));
  const k = W / 720;
  const px = (v) => Math.round(v * k);

  const PAPER_HI = '#F5EDDB';
  const PAPER_LO = '#E7DAC2';
  const INK = '#2B2118';
  const ACCENT = '#C2632A';
  const RULE = 'rgba(150,120,88,0.32)';
  const RULE_SOFT = 'rgba(150,120,88,0.14)';
  const MUTED_INK = 'rgba(86,66,46,0.56)';

  // ---------- 1) 左上刊头 ----------
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(244,235,220,0.94)';
  ctx.font = `700 ${px(20)}px ${fontFamily}`;
  const headEnd = spaced(ctx, 'AI 日記', W * 0.024, H * 0.078, px(3.4));

  const capText = 'Homo sapiens v1.0';
  ctx.font = `600 ${px(11)}px ${fontFamily}`;
  const capH = px(22);
  const capW = spacedWidth(ctx, capText, px(0.9)) + px(20);
  const capX = headEnd + px(12);
  const capY = H * 0.078 - capH * 0.70;
  ctx.strokeStyle = 'rgba(232,199,154,0.42)';
  ctx.lineWidth = 1;
  rr(ctx, capX, capY, capW, capH, capH / 2);
  ctx.stroke();
  ctx.fillStyle = 'rgba(232,199,154,0.80)';
  ctx.font = `600 ${px(11)}px ${fontFamily}`;
  spaced(ctx, capText, capX + px(10), capY + capH * 0.70, px(0.9));

  // 刊头下的短横线
  ctx.strokeStyle = 'rgba(232,199,154,0.30)';
  ctx.beginPath();
  ctx.moveTo(W * 0.024, H * 0.078 + px(12));
  ctx.lineTo(W * 0.024 + px(84), H * 0.078 + px(12));
  ctx.stroke();

  // ---------- 2) 纸卡 ----------
  const cw = W * 0.706;
  const ch = H * 0.664;
  const cx = W * 0.026;
  const cy = H * 0.130;

  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.50)';
  ctx.shadowBlur = px(26);
  ctx.shadowOffsetY = px(10);
  const grad = ctx.createLinearGradient(cx, cy, cx, cy + ch);
  grad.addColorStop(0, PAPER_HI);
  grad.addColorStop(1, PAPER_LO);
  ctx.fillStyle = grad;
  rr(ctx, cx, cy, cw, ch, px(14));
  ctx.fill();
  ctx.restore();

  // 纸纹：淡横格 + 更淡竖格
  ctx.save();
  rr(ctx, cx, cy, cw, ch, px(14));
  ctx.clip();
  ctx.lineWidth = 1;
  const gapY = px(26);
  const gapX = px(26);
  ctx.strokeStyle = RULE_SOFT;
  for (let gy = cy + gapY; gy < cy + ch; gy += gapY) {
    ctx.beginPath(); ctx.moveTo(cx, gy); ctx.lineTo(cx + cw, gy); ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(150,120,88,0.08)';
  for (let gx = cx + gapX; gx < cx + cw; gx += gapX) {
    ctx.beginPath(); ctx.moveTo(gx, cy); ctx.lineTo(gx, cy + ch); ctx.stroke();
  }
  // 左上角一层柔光，纸面不平
  const sheen = ctx.createRadialGradient(cx + cw * 0.18, cy + ch * 0.06, 0, cx + cw * 0.18, cy + ch * 0.06, cw * 0.85);
  sheen.addColorStop(0, 'rgba(255,250,238,0.22)');
  sheen.addColorStop(1, 'rgba(255,250,238,0)');
  ctx.fillStyle = sheen;
  ctx.fillRect(cx, cy, cw, ch);
  ctx.restore();

  // 双线边 + 四角裁切标
  ctx.strokeStyle = RULE;
  ctx.lineWidth = 1;
  rr(ctx, cx, cy, cw, ch, px(14));
  ctx.stroke();
  ctx.strokeStyle = 'rgba(150,120,88,0.18)';
  rr(ctx, cx + px(5), cy + px(5), cw - px(10), ch - px(10), px(10));
  ctx.stroke();

  const cornerLen = px(13);
  ctx.strokeStyle = 'rgba(120,92,62,0.38)';
  for (const [ax, ay, dx, dy] of [
    [cx + px(16), cy + px(16), 1, 1],
    [cx + cw - px(16), cy + px(16), -1, 1],
    [cx + px(16), cy + ch - px(16), 1, -1],
    [cx + cw - px(16), cy + ch - px(16), -1, -1],
  ]) {
    ctx.beginPath();
    ctx.moveTo(ax, ay + dy * cornerLen);
    ctx.lineTo(ax, ay);
    ctx.lineTo(ax + dx * cornerLen, ay);
    ctx.stroke();
  }

  // ---------- 3) 卡内页眉 ----------
  const padX = px(32);
  const headY = cy + px(38);
  ctx.fillStyle = ACCENT;
  ctx.font = `700 ${px(10)}px ${fontFamily}`;
  spaced(ctx, 'AI DIARY  /  TRANSCRIPT', cx + padX, headY, px(2));

  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(120,92,62,0.60)';
  ctx.font = `600 ${px(10)}px ${fontFamily}`;
  ctx.fillText(`NO. ${String(days).padStart(3, '0')}`, cx + cw - padX, headY);
  ctx.textAlign = 'left';

  ctx.strokeStyle = RULE;
  ctx.beginPath();
  ctx.moveTo(cx + padX, headY + px(14));
  ctx.lineTo(cx + cw - padX, headY + px(14));
  ctx.stroke();

  // ---------- 4) 台词 ----------
  const bodyTop = headY + px(46);
  const bodyX = cx + padX + px(12);
  const bodyW = cw - padX * 2 - px(12);
  const footY = cy + ch - px(26);

  // 先收段落，再按文本量决定字号：只有一两句时用大字，免得纸面显得空
  const raw = [];
  if (t >= 0.9 && tl && tl.length) {
    const from = Math.max(0, idx - 3);
    for (let i = from; i <= idx; i += 1) {
      const b = tl[i] || {};
      let txt = String(b.text || '');
      if (i === idx) {
        const inBeat = (t - b.start) / Math.max(0.001, b.dur);
        const chars = [...txt];
        txt = chars.slice(0, Math.max(0, Math.min(chars.length, Math.floor(chars.length * Math.min(1, inBeat * 1.25))))).join('');
      }
      if (txt) raw.push({ txt, cur: i === idx });
    }
  }
  const charsAll = raw.reduce((n, b) => n + [...b.txt].length, 0);
  // 只有一句话时放大，占住纸面；一旦有历史段落就回到常规字号，保证能同时看到上一段
  const big = raw.length <= 1 && charsAll <= 24;
  const fsHist = big ? px(24) : px(20);
  const fsCur = big ? px(34) : px(23);
  const lh = Math.round(fsCur * (big ? 1.48 : 1.56));
  const avail = footY - px(34) - bodyTop;
  const maxRows = Math.max(1, Math.floor(avail / lh));

  const blocks = raw.map((b) => {
    ctx.font = `${b.cur ? 600 : 500} ${b.cur ? fsCur : fsHist}px ${fontFamily}`;
    return { lines: wrapChars(ctx, b.txt, bodyW), cur: b.cur };
  });

  const rows = [];
  blocks.forEach((b, bi) => {
    if (bi > 0) rows.push({ gap: true });
    for (const ln of b.lines) rows.push({ ln, cur: b.cur });
  });

  const shown = rows.slice(-maxRows);
  let contentH = 0;
  for (const r of shown) contentH += r.gap ? Math.round(lh * 0.62) : lh;
  let y = bodyTop + Math.max(px(4), (avail - contentH) * 0.40) + lh;

  const bodyA = t < 1.50 ? 0 : Math.min(1, (t - 1.50) / 0.40);
  if (bodyA > 0) {
  ctx.save();
  ctx.globalAlpha = bodyA;

  // 引号贴着第一行上沿，像稿纸上的引文起头
  let firstY = y;
  for (const r of shown) { if (r.ln) break; firstY += Math.round(lh * 0.62); }
  ctx.fillStyle = 'rgba(194,99,42,0.24)';
  ctx.font = `700 ${px(40)}px Georgia, ${fontFamily}`;
  ctx.fillText('“', bodyX - px(4), firstY - fsCur * 0.88);

  shown.forEach((r) => {
    if (r.gap) {
      ctx.fillStyle = 'rgba(120,92,62,0.52)';
      ctx.font = `600 ${px(14)}px ${fontFamily}`;
      spaced(ctx, '·   ·   ·', bodyX + px(8), y, px(6));
      y += Math.round(lh * 0.62);
      return;
    }
    const fs = r.cur ? fsCur : fsHist;
    if (r.cur) {
      ctx.fillStyle = 'rgba(194,99,42,0.85)';
      ctx.fillRect(bodyX - px(11), y - fs * 0.80, px(2.8), fs * 1.10);
    }
    ctx.fillStyle = r.cur ? '#33261B' : MUTED_INK;
    ctx.font = `${r.cur ? 600 : 500} ${fs}px ${fontFamily}`;
    ctx.fillText(r.ln, bodyX, y);
    y += lh;
  });
  ctx.restore();
  }

  // ---------- 5) 页脚 ----------
  ctx.strokeStyle = RULE;
  ctx.beginPath();
  ctx.moveTo(cx + padX, footY - px(20));
  ctx.lineTo(cx + cw - padX, footY - px(20));
  ctx.stroke();

  ctx.fillStyle = 'rgba(76,58,40,0.72)';
  ctx.font = `600 ${px(10)}px ${fontFamily}`;
  spaced(ctx, `DAY ${days}   ·   餘額 ¥${money.toFixed(2)}`, cx + padX, footY, px(1.2));

  const footR = `評測員 ${zh}   ·   ${String(idx + 1).padStart(2, '0')}/${String(total).padStart(2, '0')}`;
  ctx.font = `600 ${px(10)}px ${fontFamily}`;
  const footRW = spacedWidth(ctx, footR, px(1.2));
  ctx.fillStyle = 'rgba(120,92,62,0.58)';
  spaced(ctx, footR, cx + cw - padX - footRW, footY, px(1.2));
  ctx.textAlign = 'left';

  // ---------- 6) 卡外右侧：竖排刊名 + 印章 ----------
  const sideX = cx + cw + W * 0.052;
  ctx.save();
  ctx.translate(sideX, H * 0.300);
  ctx.rotate(Math.PI / 2);
  ctx.fillStyle = 'rgba(240,230,212,0.26)';
  ctx.font = `700 ${px(11)}px ${fontFamily}`;
  spaced(ctx, 'HOMO SAPIENS  ·  FIELD NOTES', 0, 0, px(2.2));
  ctx.restore();

  const sealX = W * 0.902;
  const sealY = H * 0.600;
  const sealR = px(36);
  ctx.save();
  ctx.translate(sealX, sealY);
  ctx.rotate(-0.12);
  ctx.strokeStyle = 'rgba(194,99,42,0.46)';
  ctx.lineWidth = px(1.6);
  ctx.beginPath(); ctx.arc(0, 0, sealR, 0, Math.PI * 2); ctx.stroke();
  ctx.lineWidth = px(0.9);
  ctx.beginPath(); ctx.arc(0, 0, sealR - px(5), 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = 'rgba(194,99,42,0.56)';
  ctx.textAlign = 'center';
  ctx.font = `700 ${px(22)}px ${fontFamily}`;
  ctx.fillText('AI', 0, px(8));
  ctx.font = `700 ${px(9)}px ${fontFamily}`;
  spacedCenter(ctx, 'DIARY', 0, px(22), px(2.2));
  ctx.fillStyle = 'rgba(194,99,42,0.38)';
  ctx.font = `600 ${px(6.5)}px ${fontFamily}`;
  spacedCenter(ctx, 'CERTIFIED', 0, -px(16), px(1.4));
  ctx.restore();
  ctx.textAlign = 'left';

  // ---------- 7) 左下 REC ----------
  const recY = H * 0.952;
  const blink = Math.sin(t * 4.4) > -0.2;
  ctx.fillStyle = blink ? '#E8582F' : 'rgba(232,88,47,0.26)';
  ctx.beginPath(); ctx.arc(W * 0.026, recY - px(4), px(3.2), 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = 'rgba(240,230,215,0.74)';
  ctx.font = `600 ${px(11)}px ${fontFamily}`;
  const tc = `T+${String(Math.floor(t)).padStart(2, '0')}:${String(Math.floor((t % 1) * 24)).padStart(2, '0')}`;
  const recEnd = spaced(ctx, `REC   AI DIARY  ·  TAKE ${String(idx + 1).padStart(2, '0')}   ${tc}`, W * 0.040, recY, px(1.2));

  ctx.strokeStyle = 'rgba(240,230,215,0.18)';
  ctx.beginPath();
  ctx.moveTo(recEnd + px(14), recY - px(4));
  ctx.lineTo(cx + cw, recY - px(4));
  ctx.stroke();

  ctx.textAlign = 'left';
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
  chat: {
    paper: '#F4EEE2', ink: '#2B2118', accent: '#C2632A',
    frame: 'rgba(120,90,60,0.32)', watermark: 'rgba(194,99,42,0.10)',
    kicker: 'AI DIARY / FIELD NOTES', footer: 'rgba(58,44,32,0.72)',
    outroRGB: '194,99,42', outroLabel: 'END OF THE DAY', outroText: '#F7F1E6',
  },
};
const pal = (tpl) => INTRO_PALETTE[tpl.id] || INTRO_PALETTE.report;

export function drawTemplateIntro(ctx, tpl, { W, H, t, ep, script, fontFamily, wrapBalanced }) {
  const k = W / 720;
  if (tpl.id === 'classic') return false;
  const a = t < 0.55 ? t / 0.55 : t < 0.95 ? 1 : Math.max(0, 1 - (t - 0.95) / 0.45);
  if (a <= 0) { ctx.globalAlpha = 1; ctx.textAlign = 'left'; return true; }
  const P = pal(tpl);

  // 对话卡：不另起一张卡，正文区在片头期间留白，只在纸上写开场标题
  if (tpl.id === 'chat') {
    const cw = W * 0.706, ch = H * 0.664, cx = W * 0.026, cy = H * 0.130;
    const padX = Math.round(32 * k);
    const bw = cw - padX * 2;
    const by = cy + Math.round(38 * k) + Math.round(46 * k);
    const bh = (cy + ch - Math.round(26 * k)) - by;
    const cxm = cx + cw / 2;

    ctx.globalAlpha = a;
    ctx.textAlign = 'center';
    ctx.fillStyle = P.accent;
    ctx.font = `700 ${Math.round(12 * k)}px ${fontFamily}`;
    ctx.fillText(P.kicker, cxm, by + bh * 0.18);
    ctx.globalAlpha = a * 0.5;
    ctx.strokeStyle = P.accent;
    ctx.beginPath();
    ctx.moveTo(cxm - 26, by + bh * 0.18 + 14);
    ctx.lineTo(cxm + 26, by + bh * 0.18 + 14);
    ctx.stroke();
    ctx.globalAlpha = a;

    ctx.fillStyle = P.ink;
    const tfs = Math.round(24 * k);
    ctx.font = `700 ${tfs}px ${fontFamily}`;
    const lines = wrapBalanced(ctx, script.title || 'AI 日记', bw * 0.94);
    const lh = Math.round(tfs * 1.5);
    const top = by + bh * 0.50;
    lines.forEach((ln, i) => ctx.fillText(ln, cxm, top + i * lh));

    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
    return true;
  }

  ctx.fillStyle = `rgba(4,6,10,${(0.94 * a).toFixed(3)})`;
  ctx.fillRect(0, 0, W, H);

  ctx.globalAlpha = a;
  const cardW = W * 0.84, cardH = H * 0.34, x = W * 0.08, y = H * 0.325;
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
  ctx.font = `700 ${Math.round(44 * k)}px ${fontFamily}`;
  ctx.textAlign = 'right';
  ctx.fillText('01', x + cardW - 26, y + cardH - 20);

  ctx.textAlign = 'center';
  ctx.fillStyle = P.accent;
  ctx.font = `700 ${Math.round(13 * k)}px ${fontFamily}`;
  const kickY = y + 48;
  ctx.fillText(P.kicker, W / 2, kickY);

  // 细分隔线
  ctx.strokeStyle = P.accent;
  ctx.globalAlpha = a * 0.5;
  ctx.beginPath(); ctx.moveTo(W / 2 - 26, kickY + 14); ctx.lineTo(W / 2 + 26, kickY + 14); ctx.stroke();
  ctx.globalAlpha = a;

  ctx.fillStyle = P.ink;
  const tfs = Math.round(20 * k);
  ctx.font = `700 ${tfs}px ${fontFamily}`;
  const lines = wrapBalanced(ctx, script.title || 'AI 日记', cardW * 0.78);
  const lh = Math.round(tfs * 1.55);
  const top = y + cardH * 0.40;
  lines.forEach((ln, i) => ctx.fillText(ln, W / 2, top + i * lh));

  ctx.fillStyle = P.footer;
  ctx.font = `600 ${Math.round(12 * k)}px ${fontFamily}`;
  ctx.fillText(`DAY ${Number(ep.day ?? 1)}   ·   餘額 ¥${Number(ep.balance ?? 1).toFixed(2)}   ·   ${Number(ep.day ?? 1)} 天`, W / 2, y + cardH - 26);
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
  return true;
}

export function drawTemplateOutro(ctx, tpl, { W, H, t, total, remain, fontFamily }) {
  if (tpl.id === 'classic') return false;
  const k = W / 720;
  const a = Math.max(0, Math.min(1, (t - (total - 1.9)) / 0.7));
  if (a <= 0) { ctx.globalAlpha = 1; ctx.textAlign = 'left'; return true; }
  const P = pal(tpl);

  // 对话卡：片尾整体压暗 + 左下角一份简短的收尾信息（不画横条，免得压住大卡）
  if (tpl.id === 'chat') {
    ctx.fillStyle = `rgba(10,5,4,${(0.74 * a).toFixed(3)})`;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = a;
    ctx.textAlign = 'left';
    const x = W * 0.055, y0 = H * 0.812;
    ctx.fillStyle = P.accent;
    ctx.font = `700 13px ${fontFamily}`;
    ctx.fillText(P.outroLabel, x, y0);
    ctx.fillStyle = P.outroText;
    ctx.font = `700 34px ${fontFamily}`;
    ctx.fillText('余额 ¥' + remain.toFixed(2), x, y0 + 44);
    ctx.fillStyle = 'rgba(240,230,215,0.62)';
    ctx.font = `500 12px ${fontFamily}`;
    ctx.fillText('未完待續 · AI DIARY', x, y0 + 68);
    ctx.textAlign = 'left';
    ctx.globalAlpha = 1;
    return true;
  }

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
  ctx.font = `700 ${Math.round(11 * k)}px ${fontFamily}`;
  ctx.fillText(P.outroLabel, W * 0.095, H * 0.692);
  ctx.fillStyle = P.outroText;
  ctx.font = `700 ${Math.round(24 * k)}px ${fontFamily}`;
  ctx.fillText('余额 ¥' + remain.toFixed(2), W * 0.095, H * 0.728);
  ctx.fillStyle = 'rgba(240,230,215,0.55)';
  ctx.font = `500 ${Math.round(11 * k)}px ${fontFamily}`;
  ctx.fillText('未完待續 · AI DIARY', W * 0.095, H * 0.757);
  ctx.textAlign = 'left';
  ctx.globalAlpha = 1;
  return true;
}

export function drawTemplatePaper(ctx, tpl, g) {
  if (tpl.id === 'chat') return drawChatPaper(ctx, g);
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
