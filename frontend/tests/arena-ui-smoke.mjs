import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// Uses the system Edge and Node's WebSocket; no browser automation dependency.
const [edge, tempRoot, baseUrl] = process.argv.slice(2);
const profile = path.join(tempRoot, 'arena-edge-profile');
const child = spawn(edge, ['--headless=new', '--disable-gpu', '--no-first-run',
  '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
{ windowsHide: true, stdio: 'ignore' });
let socket;
try {
  let port;
  for (let i = 0; i < 100 && !port; i++) {
    try { port = Number((await readFile(path.join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); }
    catch { await delay(100); }
  }
  assert.ok(port, 'Edge debugging port must become ready');
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(targets.find(item => item.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let nextId = 0;
  const pending = new Map();
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    const callback = pending.get(message.id);
    if (callback) { pending.delete(message.id); callback(message); }
  };
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(id, message => {
      clearTimeout(timer);
      if (message.error) reject(new Error(JSON.stringify(message.error)));
      else resolve(message.result);
    });
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result.value;
  };
  const waitFor = async (expression, label, attempts = 100) => {
    for (let i = 0; i < attempts; i++) {
      if (await evaluate(expression)) return;
      await delay(100);
    }
    throw new Error(`UI assertion timed out: ${label}\n${await evaluate('document.body.innerText')}`);
  };
  await send('Page.enable');
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    if (!localStorage.getItem('harvester.competition')) localStorage.setItem('harvester.competition', 'example-competition');
    window.__writes = [];
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      const url = String(args[0]);
      if (args[1]?.method && args[1].method !== 'GET') window.__writes.push(url);
      if (url.includes('/simulation-monitor/arena')) {
        if (window.__failArena) throw new Error('UI test: unavailable');
        const response = await originalFetch(...args);
        if (window.__delayArena && url.includes('example-competition')) await new Promise(resolve => setTimeout(resolve, 1200));
        return response;
      }
      return originalFetch(...args);
    };
  ` });
  await send('Page.navigate', { url: `${baseUrl}/arena` });
  await waitFor(`document.body.innerText.includes('当前测试 Agent')`, 'initial current data');
  const header = await evaluate(`document.querySelector('header').innerText`);
  const selectCompetition = async title => {
    await evaluate(`document.querySelector('.arena-header-select .ant-select-selector').dispatchEvent(new MouseEvent('mousedown', {bubbles:true}))`);
    await waitFor(`Array.from(document.querySelectorAll('.ant-select-item-option')).some(el => el.title === ${JSON.stringify(title)})`, 'competition option');
    await evaluate(`Array.from(document.querySelectorAll('.ant-select-item-option')).find(el => el.title === ${JSON.stringify(title)}).click()`);
  };
  const assertGlobalUnchanged = async () => {
    assert.equal(await evaluate(`localStorage.getItem('harvester.competition')`), 'example-competition');
    assert.equal(await evaluate(`document.querySelector('header').innerText`), header);
    assert.deepEqual(await evaluate('window.__writes'), []);
  };
  await selectCompetition('Pokémon 历史测试赛事');
  await waitFor(`document.body.innerText.includes('历史测试 Agent') && document.body.innerText.includes('历史采集快照')`, 'historical data');
  await assertGlobalUnchanged();
  const previousOrigin = await evaluate('performance.timeOrigin');
  await send('Page.reload');
  await waitFor(`performance.timeOrigin !== ${previousOrigin} && !!document.querySelector('header')`, 'reload completes');
  await waitFor(`document.body.innerText.includes('历史测试 Agent')`, 'selection persists after reload');
  await assertGlobalUnchanged();

  await evaluate('window.__delayArena = true');
  await selectCompetition('示例竞赛');
  await selectCompetition('无记录测试赛事');
  await waitFor(`document.body.innerText.includes('尚未找到已保存的对战快照')`, 'empty history');
  await delay(1500);
  assert.equal(await evaluate(`document.body.innerText.includes('当前测试 Agent')`), false, 'stale response must not replace current selection');
  await assertGlobalUnchanged();

  await selectCompetition('Pokémon 历史测试赛事');
  await waitFor(`document.body.innerText.includes('历史测试 Agent')`, 'history restored');
  await evaluate('window.__failArena = true');
  await waitFor(`document.body.innerText.includes('本次刷新失败，保留上次数据')`, 'automatic refresh error', 400);
  assert.equal(await evaluate(`document.body.innerText.includes('历史测试 Agent')`), true);
  await assertGlobalUnchanged();
  console.log('Arena UI passed: independent selection, history, reload, empty state, request race, refresh failure, read-only requests.');
  await send('Browser.close');
} finally {
  socket?.close();
  if (child.exitCode === null) child.kill();
}
