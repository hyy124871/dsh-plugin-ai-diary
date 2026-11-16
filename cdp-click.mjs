const targets = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const bad = [];
const all = [];
const reqById = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Network.requestWillBeSent') reqById.set(m.params.requestId, m.params.request);
  if (m.method === 'Network.responseReceived') {
    const s = m.params.response.status;
    const req = reqById.get(m.params.requestId);
    const line = `${s} ${req?.method || ''} ${m.params.response.url}`;
    all.push(line);
    if (s >= 400) bad.push({ line, rid: m.params.requestId, url: m.params.response.url });
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

const clickRes = await evalJs(`(() => {
  const b = document.querySelector('button.wtg9ga_newSession');
  if (!b) return 'NO_BUTTON';
  b.scrollIntoView();
  b.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  b.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  b.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
  b.click();
  return 'CLICKED';
})()`);
console.log('CLICK:', clickRes);
await sleep(8000);

console.log('TEXT_AFTER:', JSON.stringify(await evalJs("document.body.innerText.slice(0,700)")));
console.log('ALL_NET:', all.slice(-25).join('\n'));
console.log('BAD:', bad.map((b) => b.line).join('\n') || '(none)');
for (const b of bad.slice(-3)) {
  try {
    const body = await send('Network.getResponseBody', { requestId: b.rid });
    console.log('BODY ' + b.url + ': ' + (body.body || '').slice(0, 500));
  } catch (e) { console.log('BODY ERR ' + e.message); }
}
ws.close();
process.exit(0);
