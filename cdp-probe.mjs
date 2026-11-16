import { readFileSync } from 'node:fs';

const listUrl = 'http://127.0.0.1:9333/json/list';
const targets = await (await fetch(listUrl)).json();
const page = targets.find((t) => t.type === 'page');
if (!page) throw new Error('no page target');

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const logs = [];

ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method === 'Runtime.consoleAPICalled') {
    logs.push('console:' + msg.params.type + ' ' + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' '));
  } else if (msg.method === 'Runtime.exceptionThrown') {
    logs.push('excep:' + (msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text));
  } else if (msg.method === 'Log.entryAdded') {
    logs.push('log:' + msg.params.entry.level + ' ' + msg.params.entry.text);
  }
});

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const myId = ++id;
    pending.set(myId, (m) => (m.error ? reject(new Error(JSON.stringify(m.error))) : resolve(m.result)));
    ws.send(JSON.stringify({ id: myId, method, params }));
  });
}

await new Promise((res) => ws.addEventListener('open', res, { once: true }));
await send('Runtime.enable');
await send('Log.enable');

const script = process.argv[2] ? readFileSync(process.argv[2], 'utf8') : 'document.body.innerText.slice(0,3000)';
const out = await send('Runtime.evaluate', {
  expression: script,
  awaitPromise: true,
  returnByValue: true,
});
console.log('--- evaluate ---');
console.log(JSON.stringify(out.result?.value ?? out, null, 1).slice(0, 8000));
console.log('--- logs ---');
console.log(logs.slice(-40).join('\n'));
ws.close();
process.exit(0);
