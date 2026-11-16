const targets = await (await fetch('http://127.0.0.1:9333/json/list')).json();
const page = targets.find((t) => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const reqById = new Map();
const createIds = [];
const consoles = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Network.requestWillBeSent') {
    reqById.set(m.params.requestId, m.params.request);
  }
  if (m.method === 'Network.responseReceived' && /session\/create/.test(m.params.response.url)) {
    createIds.push({ rid: m.params.requestId, status: m.params.response.status });
  }
  if (m.method === 'Runtime.consoleAPICalled') {
    consoles.push(m.params.type + ': ' + m.params.args.map((a) => a.value ?? a.description ?? JSON.stringify(a.preview ?? '')).join(' ').slice(0, 400));
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    consoles.push('EXCEPTION: ' + (d.exception?.description || d.text || '').slice(0, 500));
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

await evalJs("document.querySelector('button.wtg9ga_newSession').click(); 'ok'");
await sleep(7000);

for (const c of createIds) {
  try {
    const body = await send('Network.getResponseBody', { requestId: c.rid });
    console.log('CREATE_RESP ' + c.status + ': ' + (body.body || '').slice(0, 800));
  } catch (e) { console.log('CREATE_RESP ERR ' + e.message); }
}
console.log('CONSOLES:\n' + consoles.slice(-25).join('\n'));
console.log('DOM_MAIN:', JSON.stringify(await evalJs("(() => { const m = document.querySelector('main'); return m ? m.innerText.slice(0,300) : 'no main'; })()")));
console.log('SIDEBAR_RECENT:', JSON.stringify(await evalJs("(() => { const rows = Array.from(document.querySelectorAll('.wnFoaW_sessionRow')).map(r => (r.innerText||'').replace(/\\s+/g,' ').trim()); return rows.slice(0,10); })()")));
ws.close();
process.exit(0);
