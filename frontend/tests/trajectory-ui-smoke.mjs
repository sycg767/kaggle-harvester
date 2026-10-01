import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

// No browser-test dependency: build the real component, then exercise it in headless Edge.
const project = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fixture = await mkdtemp(join(project, 'tests', '.trajectory-ui-'));
const profile = await mkdtemp(join(tmpdir(), 'harvester-trajectory-profile-'));
const preview = await mkdtemp(join(tmpdir(), 'harvester-trajectory-preview-'));
const screenshot = join(preview, 'trajectory-tooltip.png');
const dist = join(fixture, 'dist');
let server;

function runProcess(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Process timed out: ${command}`));
    }, 60000);
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolveRun({ code, stdout, stderr });
    });
  });
}

async function removeTemporaryDirectory(path, parent) {
  const child = relative(resolve(parent), resolve(path));
  assert.ok(child && !child.startsWith('..') && !isAbsolute(child), `Unsafe cleanup path: ${path}`);
  await rm(resolve(path), { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}

try {
  await writeFile(join(fixture, 'index.html'), '<html><head><meta charset="UTF-8"></head><body><div id="root"></div><script type="module" src="/entry.tsx"></script></body></html>');
  await writeFile(join(fixture, 'entry.tsx'), `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import ScoreTrajectoryChart from '../../src/components/ScoreTrajectoryChart';

const alpha = {
  submission_id: 101, alias: 'Synthetic Alpha', total_episodes: 45, recent_episodes: [],
  rating_trajectory: [
    {game_number: 1, score: 100, score_delta: 0, result: 'tie', episode_id: 9001, timestamp: '2026-09-30T12:34:00'},
    {game_number: 20, score: 124.5, score_delta: 24.5, result: 'win', episode_id: 9002, timestamp: '2026-09-30T12:35:00'},
    {game_number: 45, score: 116.5, score_delta: -8, result: 'loss', episode_id: 9003, timestamp: '2026-09-30T12:36:00'},
  ],
};
const beta = {
  submission_id: 202, alias: 'Synthetic Beta', total_episodes: 12, recent_episodes: [],
  rating_trajectory: [
    {game_number: 1, score: 145, result: 'unknown', episode_id: 9101},
    {game_number: 12, score: 140, score_delta: -5, result: 'loss', episode_id: 9102},
  ],
};
const single = {
  submission_id: 303, alias: 'Synthetic Solo', total_episodes: 1, recent_episodes: [],
  rating_trajectory: [{game_number: 1, score: 72.25, result: 'unknown', episode_id: 9201}],
};
function Fixture() {
  const [agents, setAgents] = useState([alpha, beta]);
  window.__trajectoryScenario = (name) => setAgents(name === 'empty' ? [] : name === 'single' ? [single] : [{...alpha}, {...beta}]);
  return <main id="fixture" style={{width: 1100, maxWidth: '100%', margin: '24px auto', fontFamily: 'Arial, sans-serif'}}>
    <h2>Trajectory hover verification — synthetic data</h2>
    <p>Browser test fixture only. No competition results or live service requests.</p>
    <ScoreTrajectoryChart agents={agents} competitionTitle="Synthetic UI smoke test" />
  </main>;
}
createRoot(document.getElementById('root')).render(<Fixture/>);
`);
  await writeFile(join(fixture, 'vite.config.mjs'), `export default {root:${JSON.stringify(fixture)},build:{outDir:${JSON.stringify(dist)},emptyOutDir:true}};`);
  const build = await runProcess(process.execPath, [join(project, 'node_modules/vite/bin/vite.js'), 'build', '--config', join(fixture, 'vite.config.mjs')]);
  assert.equal(build.code, 0, `Fixture build failed: ${build.stderr}`);

  const injection = `<script>
window.__errors = [];
window.addEventListener('error', event => window.__errors.push(event.message));
window.addEventListener('unhandledrejection', event => window.__errors.push(String(event.reason)));
const pause = () => new Promise(resolve => setTimeout(resolve, 30));
const check = (condition, message) => { if (!condition) throw new Error(message); };
const chart = () => document.querySelector('svg[aria-label="Synthetic UI smoke test — Rating Progression"]');
const tooltip = () => chart()?.querySelector('[role="tooltip"]');
const text = () => tooltip()?.textContent || '';
const paths = () => [...chart().querySelectorAll('path[stroke-width="1.5"]')];
const vertices = path => [...path.getAttribute('d').matchAll(/[ML]\\s+([\\d.-]+)\\s+([\\d.-]+)/g)].map(match => ({x: Number(match[1]), y: Number(match[2])}));
const inspect = async (point, type = 'pointermove') => {
  const svg = chart();
  const screen = new DOMPoint(point.x, point.y).matrixTransform(svg.getScreenCTM());
  svg.dispatchEvent(new PointerEvent(type, {bubbles: true, pointerId: 1, pointerType: 'mouse', clientX: screen.x, clientY: screen.y}));
  await pause();
  return screen;
};
const verifyPoint = (label, game, score, delta, episode, time) => {
  const value = text();
  for (const expected of [label, '第 ' + game + ' 局', '积分 ' + score, '单局变化 ' + delta, '对局 #' + episode, '时间：' + time]) {
    check(value.includes(expected), 'Missing tooltip content ' + expected + '; actual=' + value);
  }
};
const formattedTime = minute => new Date('2026-09-30T12:' + minute + ':00').toLocaleString('zh-CN', {month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'});
const run = async () => {
  const result = {};
  try {
    for (let count = 0; count < 100 && !chart(); count++) await pause();
    check(chart(), 'Chart did not mount');
    check(paths().length === 2, 'Expected two unequal-length series');
    const alpha = vertices(paths()[0]);
    const beta = vertices(paths()[1]);
    check(alpha.length === 3 && beta.length === 2, 'Fixture series length');

    await inspect(alpha[0]);
    verifyPoint('Synthetic Alpha', 1, 100, '0 分', 9001, formattedTime('34'));
    check(text().includes('平 ·'), 'Zero-delta draw result');
    result.zeroDelta = true;

    await inspect(alpha[1]);
    verifyPoint('Synthetic Alpha', 20, 124.5, '+24.5 分', 9002, formattedTime('35'));
    check(text().includes('胜 ·'), 'Positive-delta win result');
    result.positiveDelta = true;

    await inspect(alpha[2]);
    verifyPoint('Synthetic Alpha', 45, 116.5, '-8 分', 9003, formattedTime('36'));
    check(text().includes('负 ·'), 'Negative-delta loss result');
    result.negativeDelta = true;

    await inspect(beta[1]);
    verifyPoint('Synthetic Beta', 12, 140, '-5 分', 9102, '未记录');
    check(!text().includes('Synthetic Alpha'), 'Stale agent tooltip');
    result.shortSeriesAndMissingTime = true;

    await inspect(beta[0]);
    verifyPoint('Synthetic Beta', 1, 145, '未记录', 9101, '未记录');
    check(text().includes('结果未知'), 'Missing result must remain unknown');
    result.missingDelta = true;

    // A position inside a long segment, far from either sample, still picks a real sample.
    await inspect({x: alpha[0].x + (alpha[1].x - alpha[0].x) * 0.55, y: alpha[0].y + (alpha[1].y - alpha[0].y) * 0.55});
    verifyPoint('Synthetic Alpha', 20, 124.5, '+24.5 分', 9002, formattedTime('35'));
    result.segmentHover = true;

    chart().dispatchEvent(new PointerEvent('pointerout', {bubbles: true, relatedTarget: document.body, pointerType: 'mouse'}));
    await pause();
    check(!tooltip(), 'Tooltip did not clear on leave');
    result.pointerLeave = true;

    await inspect(alpha[0], 'pointerdown');
    check(tooltip(), 'Pointer-down inspection failed');
    chart().dispatchEvent(new PointerEvent('pointercancel', {bubbles: true, pointerType: 'touch'}));
    await pause();
    check(!tooltip(), 'Tooltip did not clear on cancel');
    result.pointerDownAndCancel = true;

    await inspect(alpha[1]);
    await inspect({x: 4, y: 4});
    check(!tooltip(), 'Tooltip did not clear outside plot');
    result.outsidePlot = true;

    const fixture = document.getElementById('fixture');
    const originalScale = chart().getScreenCTM().a;
    fixture.style.width = '760px';
    await pause();
    check(chart().getScreenCTM().a < originalScale, 'Responsive resize did not scale SVG');
    await inspect(alpha[1]);
    verifyPoint('Synthetic Alpha', 20, 124.5, '+24.5 分', 9002, formattedTime('35'));
    result.responsiveScale = true;

    fixture.style.width = '320px';
    fixture.style.zoom = '1.25';
    await pause();
    const scroller = chart().parentElement;
    check(scroller.scrollWidth > scroller.clientWidth, 'Expected horizontal overflow');
    scroller.scrollLeft = scroller.scrollWidth - scroller.clientWidth;
    await pause();
    check(scroller.scrollLeft > 0, 'Horizontal scrolling did not occur');
    const screen = await inspect(alpha[2]);
    const viewport = scroller.getBoundingClientRect();
    check(screen.x > viewport.left && screen.x < viewport.right, 'Scrolled target is not visible');
    verifyPoint('Synthetic Alpha', 45, 116.5, '-8 分', 9003, formattedTime('36'));
    result.zoomAndHorizontalScroll = true;

    window.__trajectoryScenario('main');
    await pause();
    check(!tooltip(), 'Refreshed props retained an old tooltip');
    result.propsRefresh = true;

    fixture.style.width = '1100px';
    fixture.style.zoom = '1';
    window.__trajectoryScenario('single');
    await pause();
    check(paths().length === 1, 'Single point chart missing');
    await inspect(vertices(paths()[0])[0]);
    verifyPoint('Synthetic Solo', 1, 72.3, '未记录', 9201, '未记录');
    check(chart().querySelector('circle[r="3"]'), 'Single point is not visually marked');
    result.singlePoint = true;

    window.__trajectoryScenario('empty');
    await pause();
    check(!chart() && !document.querySelector('[role="tooltip"]'), 'Empty props retained the chart or tooltip');
    check(document.body.textContent.includes('暂无轨迹数据'), 'Empty-state message missing');
    result.emptyData = true;

    // Leave a useful, explicitly synthetic hover preview for manual visual QA.
    window.__trajectoryScenario('main');
    await pause();
    await inspect(vertices(paths()[0])[1]);
    verifyPoint('Synthetic Alpha', 20, 124.5, '+24.5 分', 9002, formattedTime('35'));
    result.browserErrors = window.__errors;
  } catch (error) {
    result.error = String(error);
    result.browserErrors = window.__errors;
  }
  document.body.setAttribute('data-trajectory-result', JSON.stringify(result));
};
window.addEventListener('load', run, {once: true});
</script>`;

  server = http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, 'http://local').pathname;
      const file = pathname.startsWith('/assets/') ? join(dist, pathname) : join(dist, 'index.html');
      const content = await readFile(file);
      const type = extname(file);
      res.setHeader('Content-Type', type === '.js' ? 'text/javascript' : type === '.css' ? 'text/css' : type === '.html' ? 'text/html' : 'application/octet-stream');
      res.end(type === '.html' ? content.toString().replace('<head>', '<head>' + injection) : content);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
  const edge = process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const browser = await runProcess(edge, ['--headless=new', '--disable-gpu', '--no-first-run', '--hide-scrollbars', '--window-size=1280,900', '--virtual-time-budget=10000', `--user-data-dir=${profile}`, `--screenshot=${screenshot}`, '--dump-dom', `http://127.0.0.1:${server.address().port}/trajectory`]);
  assert.equal(browser.code, 0, `Edge failed: ${browser.stderr}`);
  const match = browser.stdout.match(/data-trajectory-result="([^"]+)"/);
  assert.ok(match, 'Browser trajectory scenarios did not complete');
  const actual = JSON.parse(match[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>'));
  assert.deepEqual(actual, {
    zeroDelta: true,
    positiveDelta: true,
    negativeDelta: true,
    shortSeriesAndMissingTime: true,
    missingDelta: true,
    segmentHover: true,
    pointerLeave: true,
    pointerDownAndCancel: true,
    outsidePlot: true,
    responsiveScale: true,
    zoomAndHorizontalScroll: true,
    propsRefresh: true,
    singlePoint: true,
    emptyData: true,
    browserErrors: [],
  });
  assert.ok((await readFile(screenshot)).length > 0, 'Missing browser preview');
  console.log('Trajectory browser smoke passed:', actual);
  console.log('Synthetic hover preview:', screenshot);
} finally {
  if (server?.listening) await new Promise(resolveClose => server.close(resolveClose));
  await removeTemporaryDirectory(profile, tmpdir());
  await removeTemporaryDirectory(fixture, join(project, 'tests'));
}
