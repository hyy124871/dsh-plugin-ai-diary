const targets = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const bad = [];
const okay = [];
const reqById = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Network.requestWillBeSent') reqById.set(m.params.requestId, m.params.request);
  if (m.method === 'Network.responseReceived') {
    const s = m.params.response.status;
    const req = reqById.get(m.params.requestId);
    const line = `${s} ${m.params.response.url} ${req?.method || ''}`;
    if (s >= 400) bad.push(line); else okay.push(line);
  }
});

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const myId = ++id;
    pending.set(myId, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: myId, method, params }));
  });
}
async function evalJs(expression) {
  const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  return r.result?.value;
}

await new Promise((r) => ws.addEventListener('open', r, { once: true }));
await send('Network.enable');
await send('Runtime.enable');

const cands = await evalJs(`(() => {
  const out = [];
  for (const n of document.querySelectorAll('button, a, [role="button"], [tabindex]')) {
    const t = (n.innerText || n.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim();
    if (t) out.push(n.tagName + '|' + t.slice(0, 30) + '|' + (n.className || '').toString().slice(0, 40));
  }
  return out.slice(0, 40);
})()`);
console.log('CANDS:\n' + (cands || []).join('\n'));

// Ctrl+N
const key = { key: 'N', code: 'KeyN', windowsVirtualKeyCode: 78, nativeVirtualKeyCode: 78, modifiers: 2 };
await send('Input.dispatchKeyEvent', { type: 'keyDown', ...key });
await send('Input.dispatchKeyEvent', { type: 'keyUp', ...key });
await sleep(6000);

console.log('TEXT_AFTER:', JSON.stringify(await evalJs("document.body.innerText.slice(0,600)")));
console.log('BAD:', bad.join('\n') || '(none)');
console.log('OK:', okay.filter((l) => /session|workspace|api/i.test(l)).slice(-12).join('\n'));
ws.close();
process.exit(0);
