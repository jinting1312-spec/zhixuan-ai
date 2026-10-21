// Optional browser verification: start a separate headless Chromium instance
// with --remote-debugging-port=9229 and a temporary profile before running.
// Uses the native DevTools protocol, with no additional project dependency.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
const tabs = await (await fetch('http://127.0.0.1:9229/json/list')).json();
const tab = tabs.find(t => t.type === 'page');
assert.ok(tab?.webSocketDebuggerUrl, 'No local browser debugging target');
const ws = new WebSocket(tab.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let seq = 0;
const waiting = new Map();
const errors = [];
ws.onmessage = event => {
  const data = JSON.parse(event.data);
  if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails.text);
  const entry = waiting.get(data.id);
  if (!entry) return;
  waiting.delete(data.id);
  clearTimeout(entry.timer);
  if (data.error) entry.reject(new Error(data.error.message)); else entry.resolve(data.result);
};
function command(method, params = {}) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiting.delete(id); reject(new Error(`Timeout: ${method}`)); }, 60000);
    waiting.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await command('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error('Browser evaluation failed');
  return result.result.value;
}
async function until(expression, timeout = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await evaluate(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(`Browser condition timed out: ${expression}`);
}
async function fill(selector, value, textarea = false) {
  await evaluate(`(() => { const e=document.querySelector(${JSON.stringify(selector)}); const setter=Object.getOwnPropertyDescriptor(${textarea ? 'HTMLTextAreaElement' : 'HTMLInputElement'}.prototype,'value').set; setter.call(e,${JSON.stringify(value)}); e.dispatchEvent(new Event('input',{bubbles:true})); })()`);
}
const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
try {
  await command('Runtime.enable'); await command('Page.enable');
  await command('Emulation.setDeviceMetricsOverride', { width: 1512, height: 1120, deviceScaleFactor: 1, mobile: false });
  await command('Page.navigate', { url: 'http://127.0.0.1:3000' });
  await until(`document.querySelector('.run-button') && document.readyState === 'complete'`);
  await new Promise(resolve => setTimeout(resolve, 800));
  await fill('#peMin', '40');
  await until(`!!document.querySelector('.conflicts') && document.querySelector('.run-button').disabled`);
  await fill('#peMin', '0');
  await until(`!document.querySelector('.conflicts') && !document.querySelector('.run-button').disabled`);
  console.log('PASS: browser numeric edit and conflict prevention.');
  await click('.run-button');
  await until(`document.querySelectorAll('.stock-row').length === 20`);
  await click('.stock-row');
  assert.equal(await evaluate(`document.querySelectorAll('.check-card').length`), 3);
  await click('.raw-details summary');
  assert.equal(await evaluate(`document.querySelectorAll('.raw-table tbody tr').length`), 21);
  console.log('PASS: browser real screening, 20 rows, 3 condition explanations, 21 raw closing prices.');
  await fill('#growthMin', '7');
  await until(`!!document.querySelector('.stale-banner')`);
  await click('.library-button');
  await fill('input[aria-label="方案名称"]', '浏览器验证方案');
  await click('.save-form button');
  await until(`document.querySelectorAll('.saved-list li').length >= 1`);
  await command('Page.reload');
  await until(`document.querySelector('.library-button') && document.readyState === 'complete'`);
  await new Promise(resolve => setTimeout(resolve, 800));
  await click('.library-button');
  await until(`document.querySelectorAll('.saved-list li').length >= 1`);
  await click('.saved-list li .text-button');
  await until(`document.querySelector('#growthMin').value === '7'`);
  console.log('PASS: browser localStorage save, reload and load; changed criteria mark old results.');
  await click('.saved-list li .muted');
  await click('.saved-panel .section-title button');
  await fill('#intent', '归母净利润同比大于5%，PE大于0且小于25，波动率小于2%', true);
  await click('.ai-button');
  await until(`document.querySelector('#growthMin').value === '5' && document.querySelector('#peMax').value === '25' && !document.querySelector('.ai-button').disabled`);
  assert.equal(await evaluate(`document.querySelector('#volatilityMax').value`), '2');
  console.log('PASS: browser actual AI parse applies editable candidate conditions.');
  await click('.run-button');
  await until(`document.querySelectorAll('.stock-row').length === 20`);
  await click('.stock-row');
  await evaluate('window.scrollTo(0,0)');
  if (process.env.SCREENSHOT_DIR) {
    const shot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await fs.writeFile(path.join(process.env.SCREENSHOT_DIR, 'zhixuan-results.png'), Buffer.from(shot.data, 'base64'));
  }
  await command('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  assert.ok(await evaluate('document.documentElement.scrollWidth <= window.innerWidth'), 'Mobile horizontal overflow');
  if (process.env.SCREENSHOT_DIR) {
    const shot = await command('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await fs.writeFile(path.join(process.env.SCREENSHOT_DIR, 'zhixuan-mobile.png'), Buffer.from(shot.data, 'base64'));
  }
  assert.equal(errors.length, 0, 'Uncaught browser runtime exception');
  console.log('PASS: responsive width 390px; no horizontal overflow or uncaught browser exceptions.');
} finally { ws.close(); }
