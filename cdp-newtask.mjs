const targets = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const bad = [];
const errs = [];
const reqs = [];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Network.requestWillBeSent') {
    reqs.push({ rid: m.params.requestId, url: m.params.request.url, method: m.params.request.method });
  }
  if (m.method === 'Network.responseReceived') {
    const s = m.params.response.status;
    if (s >= 400) bad.push(`${s} ${m.params.response.url}`);
  }
  if (m.method === 'Runtime.exceptionThrown') {
    errs.push('excep ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text).slice(0, 300));
  }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    errs.push('log ' + m.params.entry.text.slice(0, 300));
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
await send('Log.enable');

// before
console.log('BEFORE:', JSON.stringify(await evalJs("document.body.innerText.slice(0,200)")));

// find a clickable element whose text mentions 新会话/新建
const clicked = await evalJs(`(() => {
  const nodes = Array.from(document.querySelectorAll('button, a, [role="button"], div[tabindex]'));
  const hit = nodes.find(n => /新会话|新建任务|新的对话|新建/.test((n.innerText||'').trim()) && (n.innerText||'').trim().length < 12);
  if (!hit) return 'NOT_FOUND';
  hit.click();
  return 'CLICKED:' + hit.innerText.trim();
})()`);
console.log('CLICK:', clicked);

await sleep(7000);

console.log('AFTER:', JSON.stringify(await evalJs("document.body.innerText.slice(0,1200)")));
console.log('URL:', await evalJs('location.href'));
console.log('BAD:', bad.slice(-15).join('\n'));
console.log('ERRS:', errs.slice(-20).join('\n'));
ws.close();
process.exit(0);
