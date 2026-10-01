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
import {TrajectorySvg} from '../../src/components/trajectory/TrajectorySvg';

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
const screenshotAgents = [
  {
    submission_id: 404, alias: 'mer', total_episodes: 35, recent_episodes: [],
    rating_trajectory: Array.from({length: 35}, (_, index) => ({
      game_number: index + 1, score: index === 34 ? 2583.6 : 600 + 1983.6 * Math.pow(index / 34, 0.66),
      score_delta: 6.4, result: 'win', episode_id: 9300 + index,
    })),
  },
  {
    submission_id: 505, alias: 'can', total_episodes: 52, recent_episodes: [],
    rating_trajectory: Array.from({length: 52}, (_, index) => ({
      game_number: index + 1, score: index === 50 ? 2600.3 : index === 51 ? 2607.2 : 680 + 1930 * Math.pow(index / 50, 0.57),
      score_delta: index === 50 ? -9.7 : 6.9, result: index === 50 ? 'loss' : 'win', episode_id: 9400 + index,
      timestamp: '2026-10-01T02:29:00Z',
    })),
  },
];
const directSeries = (id, label, color, coordinates) => ({
  id, label, color, games: 100,
  points: coordinates.map(([x, y], index) => ({x, y, episodeId: 9500 + id * 10 + index, result: 'unknown'})),
});
const cornerChart = {
  series: [directSeries(6, 'Synthetic Corners', '#3478c5', [[0, 0], [0, 100], [100, 100], [100, 0]])],
  xMin: 0, xMax: 100, yMin: 0, yMax: 100, xTicks: [0, 50, 100], yTicks: [0, 50, 100],
};
const decorationChart = {
  ...cornerChart, goldCutoff: 50,
  series: [
    directSeries(7, 'Synthetic Legend', '#3478c5', [[0, 11], [100, 11]]),
    directSeries(8, 'Synthetic Badge', '#d14343', [[0, 50], [100, 50]]),
  ],
};
function Fixture() {
  const [agents, setAgents] = useState([alpha, beta]);
  const [scenario, setScenario] = useState('main');
  window.__trajectoryScenario = (name) => {
    setScenario(name);
    setAgents(name === 'empty' ? [] : name === 'single' ? [single] : name === 'screenshot' ? screenshotAgents : [{...alpha}, {...beta}]);
  };
  return <main id="fixture" style={{width: 1100, maxWidth: '100%', margin: '24px auto', fontFamily: 'Arial, sans-serif'}}>
    <h2>Trajectory hover verification — synthetic data</h2>
    <p>Browser test fixture only. No competition results or live service requests.</p>
    {scenario === 'corners' || scenario === 'decorations'
      ? <TrajectorySvg chart={scenario === 'corners' ? cornerChart : decorationChart} title="Synthetic UI smoke test — Rating Progression" />
      : <ScoreTrajectoryChart agents={agents} competitionTitle="Synthetic UI smoke test" thresholds={scenario === 'screenshot' ? {gold_cutoff_score: 2701.6, silver_cutoff_score: 2083, bronze_cutoff_score: 1843.7} : undefined} />}
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
const inspectHitTarget = async (point, expectedDecoration = null) => {
  const svg = chart();
  const screen = new DOMPoint(point.x, point.y).matrixTransform(svg.getScreenCTM());
  const target = document.elementFromPoint(screen.x, screen.y);
  check(target && svg.contains(target), 'Pointer target did not hit chart contents');
  if (expectedDecoration) check(target.closest('[data-trajectory-decoration]') === expectedDecoration, 'Pointer did not hit the intended chart decoration');
  target.dispatchEvent(new PointerEvent('pointermove', {bubbles: true, pointerId: 1, pointerType: 'mouse', clientX: screen.x, clientY: screen.y}));
  await pause();
};
const verifyTooltipGeometry = (description) => {
  const box = tooltip()?.querySelector('rect')?.getBBox();
  const marker = chart().querySelector('circle[r="4"]');
  const plot = chart().querySelector('rect[stroke="#cbd5e1"]')?.getBBox();
  check(box && marker && plot, description + ': missing tooltip, highlighted point, or plot');
  const x = marker.cx.baseVal.value;
  const y = marker.cy.baseVal.value;
  const dx = Math.max(box.x - x, 0, x - box.x - box.width);
  const dy = Math.max(box.y - y, 0, y - box.y - box.height);
  const markerOuterRadius = marker.r.baseVal.value + Number(marker.getAttribute('stroke-width') || 0) / 2;
  const gap = Math.hypot(dx, dy) - markerOuterRadius;
  check(gap >= 8 - 0.01, description + ': tooltip obscures highlighted point; visible gap=' + gap.toFixed(2));
  check(box.x >= plot.x && box.y >= plot.y && box.x + box.width <= plot.x + plot.width && box.y + box.height <= plot.y + plot.height, description + ': tooltip escapes plot');
};
const verifyPoint = (label, game, score, delta, episode, time) => {
  const value = text();
  for (const expected of [label, '第 ' + game + ' 局', '积分 ' + score, '单局变化 ' + delta, '对局 #' + episode, '时间：' + time]) {
    check(value.includes(expected), 'Missing tooltip content ' + expected + '; actual=' + value);
  }
};
const formattedTime = minute => new Date('2026-09-30T12:' + minute + ':00Z').toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai', hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'});
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
    const scrolled = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Scroll event did not arrive')), 2000);
      scroller.addEventListener('scroll', () => { clearTimeout(timeout); resolve(); }, {once: true});
    });
    scroller.scrollLeft = scroller.scrollWidth - scroller.clientWidth;
    await scrolled;
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

    // The user's upper-right case: the old clamp placed the tooltip over can's point.
    window.__trajectoryScenario('screenshot');
    await pause();
    await inspectHitTarget(vertices(paths()[1])[50]);
    check(text().includes('can') && text().includes('第 51 局') && text().includes('积分 2600.3'), 'Screenshot regression selected the wrong point');
    verifyTooltipGeometry('Upper-right screenshot regression');
    result.upperRightTooltipClearance = true;

    window.__trajectoryScenario('corners');
    await pause();
    const cornerPlot = chart().querySelector('rect[stroke="#cbd5e1"]').getBBox();
    for (const [index, point] of vertices(paths()[0]).entries()) {
      // Keep the pointer just inside the border to avoid subpixel CTM round-off;
      // the selected data point and marker remain exactly at the plot corner.
      await inspectHitTarget({
        x: Math.max(cornerPlot.x + 0.5, Math.min(point.x, cornerPlot.x + cornerPlot.width - 0.5)),
        y: Math.max(cornerPlot.y + 0.5, Math.min(point.y, cornerPlot.y + cornerPlot.height - 0.5)),
      });
      check(text().includes('对局 #' + (9560 + index)), 'Wrong corner point selected: ' + index + '; actual=' + text());
      verifyTooltipGeometry('Plot corner ' + index);
    }
    result.fourCornerTooltipClearance = true;

    window.__trajectoryScenario('decorations');
    await pause();
    const decorations = [...chart().querySelectorAll('[data-trajectory-decoration]')];
    const badge = decorations.find(element => element.textContent.includes('Gold'));
    const legend = decorations.find(element => element.textContent.includes('games'));
    check(badge && legend && badge !== legend, 'Missing badge or legend decoration marker');
    for (const [description, decoration] of [['medal badge', badge], ['legend', legend]]) {
      const bounds = decoration.querySelector('rect').getBBox();
      const center = {x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2};
      // Demonstrate that geometry alone would select the covered line at this position.
      await inspect(center);
      check(tooltip(), description + ': fixture does not cover an otherwise selectable line');
      await inspectHitTarget(center, decoration);
      check(!tooltip(), description + ': pointer over decoration retained a trajectory tooltip');
    }
    result.decorationHitTargets = true;

    // Leave the user's upper-right case as the final, explicitly synthetic visual preview.
    window.__trajectoryScenario('screenshot');
    await pause();
    await inspectHitTarget(vertices(paths()[1])[50]);
    verifyTooltipGeometry('Final synthetic preview');
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
    upperRightTooltipClearance: true,
    fourCornerTooltipClearance: true,
    decorationHitTargets: true,
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
