import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, extname } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

// Run after npm run build. Uses an isolated headless Edge profile and mocked fetch.
const dist = resolve('dist');
const profile = await mkdtemp(join(tmpdir(), 'harvester-ux-ui-'));
function installFixtures() {
  localStorage.setItem('harvester.competition', 'example');
  localStorage.setItem('harvester.arenaCompetition', 'example');
  window.__ux = { score: 1200, mode: 'failed', many: false, calls: [], delayCompetition: false, failSubs: false };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: {'Content-Type':'application/json', 'X-Kernel-Cache':'HIT', 'X-Kernel-Refresh':'idle', 'X-Kernel-Cache-Age':'10'} });
  const agent = id => ({ submission_id:id, alias:'Agent '+id+(id===200?' LongAliasMedicalFusion_ABCDEFGHIJKLMNOPQRSTUVWXYZ_研究实验提交':''), team_name:'Fixture', score:window.__ux.score,
    total_episodes:10, wins:6, losses:4, ties:0, system_checks:0, win_rate:60, recent_episodes:[], rating_trajectory:[], last_updated:'2026-09-01T00:00:00Z' });
  const snapshot = () => ({config:{enabled:true,competition:'example',interval_minutes:10,bronze_percentile:0.1,target_submission_ids:[200]},
    status:{competition:'example',running:false,enabled:true,scheduler_alive:true,last_checked_at:'2026-10-03T00:00:00Z',last_success_at:'2026-09-01T00:00:00Z',
      total_tracked_episodes:window.__ux.many?30:10, new_episodes_this_run:0, history:[], agents:(window.__ux.many?[200,201,202]:[200]).map(agent)},logs:[]});
  const archive = index => ({id:'archive-'+index,ref:'owner/notebook-'+index,title:'Notebook '+index,author:'owner',competition:'example',version_number:1,public_score:0.5,archived_at:'2026-10-01T00:00:00Z',path:'/archives/'+index,size_bytes:100});
  const historyLog = {id:'a'.repeat(32),competition:'example',trigger:'scheduled',outcome:'success',started_at:'2026-09-01T00:00:00Z',finished_at:'2026-09-01T00:00:00Z',duration_seconds:1,agent_count:1,total_episodes_found:10,new_episodes_found:0,details_available:true};
  window.fetch = async (url, init) => {
    const u = new URL(String(url), location.origin), p=u.pathname;
    window.__ux.calls.push({path:p,query:u.search,method:init?.method||'GET'});
    if (p === '/api/health') return json({status:'ok',ready:true,kaggle_cli:true,token_configured:true,default_competition:'example',archive:{total_archives:60,unique_kernels:60,total_size_bytes:6000},auto_archive:{},cache:{},simulation_monitor:snapshot().status});
    if (p === '/api/competitions/entered') return json(['example','contest-a','contest-b'].map(id=>({id,title:'Title '+id,is_simulation:true})));
    if (p === '/api/competition') { const id=u.searchParams.get('competition')||'example'; if(window.__ux.delayCompetition&&id==='contest-a') await sleep(1000); return json({id,title:'Title '+id,is_simulation:true,is_lower_better:true,score_direction_source:'leaderboard'}); }
    if (p === '/api/competition/active') return json({competition:'example',is_pinned:false});
    if (p === '/api/simulation-monitor') return json(snapshot());
    if (p === '/api/simulation-monitor/run') { await sleep(80); const snap=snapshot(); if(window.__ux.mode==='success'){window.__ux.score=1301;snap.status.agents[0].score=1301;}else{snap.status.last_error='模拟采集失败';} snap.logs=[{...historyLog,outcome:window.__ux.mode,error:snap.status.last_error}]; return json(snap); }
    if (p === '/api/simulation-monitor/arena') { const comp=u.searchParams.get('competition')||'example', run=u.searchParams.get('run_id'); const snap=snapshot(); snap.status.competition=comp; if(run) snap.status.agents=[{...agent(100),alias:'Selected historic Agent',score:600}]; return json({competition:comp,monitored_competition:'example',source:run?'history':'current',run_id:run,captured_at:'2026-09-01T00:00:00Z',status:snap.status}); }
    if (p === '/api/simulation-monitor/arena/history') return json({logs:[historyLog],total:1,offset:0,limit:20});
    if (p === '/api/simulation-monitor/episodes') return json({submission_id:Number(u.searchParams.get('submission_id')),offset:Number(u.searchParams.get('offset')),limit:Number(u.searchParams.get('limit')),total:10,episodes:[]});
    if (p === '/api/simulation-monitor/submissions') { const comp=u.searchParams.get('competition'); if(comp==='contest-a') await sleep(1200); if(window.__ux.failSubs) return json({detail:'模拟列表读取失败'},502); return json([{submission_id:comp==='contest-a'?101:202,description:comp==='contest-a'?'旧候选':'新候选',file_name:'agent.tar',date:'',status:'complete'}]); }
    if (p === '/api/archives') return json(Array.from({length:60},(_,i)=>archive(i)));
    if (p === '/api/archives/stats') return json({total_archives:60,unique_kernels:60,total_size_bytes:6000});
    if (p === '/api/kernels') return json([{ref:'owner/notebook',title:'Notebook result',author:'owner',public_score:1,kernel_type:'notebook',competition:'example'}]);
    if (p === '/api/auto-archive') return json({config:{enabled:false,competition:'example',interval_minutes:2,include_outputs:true,score_direction:'auto'},status:{running:false,scheduler_alive:true,recent_results:[]},logs:[]});
    if (p === '/api/submission-monitor') return json({config:{enabled:false,competitions:[],interval_minutes:10},status:{running:false,scheduler_alive:true,items:[]},logs:[]});
    if (p === '/api/notifications') return json({config:{notify_on_archive:true,notify_on_failure:true,webhook_enabled:false,email_enabled:false,wechat_enabled:false,webhook_format:'generic',smtp_to:[],secret_storage:'session'},status:{worker_alive:true,pending_count:1},deliveries:[{id:'delivery',event_id:'event-demo',event:'simulation',competition:'example',channel:'wechat',state:'failed',attempts:3,recorded_at:'2026-10-03T00:00:00Z',error:'模拟投递失败'}]});
    return json([]);
  };
}
const injection = '<script>('+installFixtures.toString()+')();</script>';
const server=http.createServer(async(req,res)=>{
  try{
    const pathname=new URL(req.url,'http://local').pathname;
    const file=pathname.startsWith('/assets/')?join(dist,pathname):join(dist,'index.html');
    const content=await readFile(file);const type=extname(file);
    res.setHeader('Content-Type',type==='.js'?'text/javascript':type==='.css'?'text/css':type==='.html'?'text/html':'application/octet-stream');
    res.end(type==='.html'?content.toString().replace('<head>','<head>'+injection):content);
  }catch{res.writeHead(404);res.end();}
});
let browser, socket;
try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const edge=process.env.EDGE_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  browser=spawn(edge,['--headless=new','--disable-gpu','--no-first-run','--remote-debugging-port=0',`--user-data-dir=${profile}`,'about:blank'],{windowsHide:true,stdio:'ignore'});
  let port;
  for (let i = 0; i < 100 && !port; i++) {
    try { port = Number((await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).split('\n')[0]); }
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
      if (await evaluate(`Boolean(${expression})`)) return;
      await delay(100);
    }
    throw new Error(`UI assertion timed out: ${label}\n${await evaluate('document.body.innerText')}`);
  };
  await send('Page.enable');
  const click = async (selector, text) => evaluate(`(() => { const el=[...document.querySelectorAll(${JSON.stringify(selector)})].find(el=>el.textContent.replaceAll(' ','').trim()===${JSON.stringify(text.replace(/\s/g,''))}); if(!el)throw new Error('Missing '+${JSON.stringify(text)});el.click();})()`);
  const input = async (selector, value) => evaluate(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); if(!el)throw new Error('Input missing');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)});el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));})()`);
  const openSelect = async selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).closest('.ant-select').querySelector('.ant-select-selector').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}))`);
  const goto = async label => { await click('.newapi-nav-label',label); await delay(250); };
  await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/arena`});
  await waitFor(`document.querySelector('.arena-freshness')?.textContent.includes('2026')`, 'freshness visible');
  await evaluate(`window.__ux.delayCompetition=true;localStorage.setItem('harvester.competition','contest-a');window.dispatchEvent(new CustomEvent('harvester:competition-changed',{detail:'contest-a'}));localStorage.setItem('harvester.competition','contest-b');window.dispatchEvent(new CustomEvent('harvester:competition-changed',{detail:'contest-b'}));`);
  await waitFor(`document.querySelector('header').textContent.includes('Title contest-b')`, 'global new choice');
  await delay(1300);
  assert.ok(await evaluate(`document.querySelector('header').textContent.includes('Title contest-b')`),'late response cannot overwrite global selection');
  await evaluate(`localStorage.setItem('harvester.competition','example');window.dispatchEvent(new CustomEvent('harvester:competition-changed',{detail:'example'}))`);
  await click('.arena-header-actions button','天梯对战监控');
  await waitFor(`document.querySelector('.simulation-monitor-modal')?.textContent.includes('已跟踪 1 个提交')`, 'actual agent count');
  assert.ok(await evaluate(`document.querySelector('.simulation-monitor-modal').textContent.includes('未知（缺少积分或奖牌线）')`));
  assert.equal(await evaluate(`document.querySelectorAll('.simulation-monitor-modal .sim-agent-card').length`),2,'one summary and one episode table');
  await click('.simulation-monitor-modal button','立即刷新');
  await waitFor(`document.querySelector('.ant-message-error')?.textContent.includes('检查失败')`, 'failed result message');
  assert.equal(await evaluate(`!!document.querySelector('.ant-message-success')`),false,'failure must not report success');
  await evaluate(`window.__ux.mode='success'`);
  await click('.simulation-monitor-modal button','立即刷新');
  await waitFor(`document.querySelector('.arena-content-stack')?.textContent.includes('1301')`, 'outer page synchronizes immediately');
  await evaluate(`window.__ux.many=true`);
  await waitFor(`document.querySelector('.simulation-monitor-modal')?.textContent.includes('已跟踪 3 个提交')`, 'three agents');
  await waitFor(`document.querySelectorAll('.simulation-monitor-modal .sim-agent-card').length===6`, 'three episode tables');
  assert.ok(await evaluate(`window.__ux.calls.some(c=>c.path.endsWith('/episodes')&&c.query.includes('submission_id=202'))`));
  await send('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await delay(300);
  assert.ok(await evaluate(`document.documentElement.scrollWidth<=390`),'mobile page has no horizontal overflow');
  assert.ok(await evaluate(`Array.from(document.querySelectorAll('.simulation-monitor-modal .ant-card-head-title')).every(el=>el.scrollWidth<=el.clientWidth+1)`),'long titles fit mobile cards');
  if(process.env.UX_SCREENSHOT_PATH){
    const shot=await send('Page.captureScreenshot',{format:'png'});
    await import('node:fs/promises').then(fs=>fs.writeFile(process.env.UX_SCREENSHOT_PATH,Buffer.from(shot.data,'base64')));
  }
  await send('Emulation.clearDeviceMetricsOverride');
  await click('.simulation-monitor-modal button','监控配置');
  await waitFor(`!!document.querySelector('#competition')`, 'settings');
  await input('#competition','contest-a');await delay(550);
  await input('#competition','contest-b');
  await waitFor(`window.__ux.calls.some(c=>c.path.endsWith('/submissions')&&c.query.includes('contest-b'))`, 'new submissions request');
  await delay(1500);await openSelect('#target_submission_ids');
  await waitFor(`document.body.innerText.includes('新候选')`, 'new candidates shown');
  assert.equal(await evaluate(`document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')?.textContent.includes('旧候选')`),false,'old list never wins');
  await evaluate(`document.querySelector('#target_submission_ids').blur();window.__ux.failSubs=true`);
  await input('#competition','contest-c');
  await waitFor(`document.body.innerText.includes('提交列表读取失败')`, 'submission failure visible');
  await evaluate(`document.querySelector('.ant-drawer-close').click()`);
  await evaluate(`document.querySelector('.simulation-monitor-modal button[aria-label="关闭"]').click()`);
  await delay(300);await click('.arena-container button','历史快照');
  await waitFor(`document.body.innerText.includes('查看快照')`, 'saved snapshot browser');
  await input('input[aria-label="快照日期（UTC）"]','2026-09-01');
  await waitFor(`window.__ux.calls.some(c=>c.path.endsWith('/arena/history')&&c.query.includes('day=2026-09-01'))`, 'history date filter');
  await click('.ant-drawer-body button','查看快照');
  await waitFor(`document.querySelector('.arena-content-stack')?.textContent.includes('Selected historic Agent')`, 'selected history loaded');
  await click('.arena-container button','返回当前 / 最新快照');
  await waitFor(`document.querySelector('.arena-content-stack')?.textContent.includes('Agent 200')`, 'current restored');
  await goto('归档管理');
  await waitFor(`document.querySelectorAll('.archive-table tbody tr').length>10`, 'archives loaded');
  await evaluate(`document.querySelector('.archive-table .ant-pagination-item-2').click()`);
  await waitFor(`document.querySelector('.archive-table .ant-pagination-item-active')?.textContent==='2'`, 'archive page 2');
  await goto('天梯对抗');await goto('归档管理');
  await waitFor(`document.querySelector('.archive-table .ant-pagination-item-active')?.textContent==='2'`, 'archive page preserved');
  await input('input[aria-label="搜索服务器归档"]','does-not-exist');
  await waitFor(`document.body.innerText.includes('没有符合当前筛选条件的归档')`, 'filtered empty message');
  await goto('天梯对抗');await goto('归档管理');
  await waitFor(`document.querySelector('input[aria-label="搜索服务器归档"]')?.value==='does-not-exist'`, 'archive search preserved');
  await click('.archive-table button','清除筛选');
  await waitFor(`document.querySelectorAll('.archive-table tbody tr').length>10`, 'filter clear works');
  await goto('代码发现');
  await waitFor(`document.body.innerText.includes('Notebook result')`, 'kernel data');
  await openSelect('input[aria-label="Kernel 排序方式"]');
  await waitFor(`document.querySelector('.ant-select-item-option[title="热度"]')`, 'sort menu');
  await evaluate(`document.querySelector('.ant-select-item-option[title="热度"]').click()`);
  await waitFor(`document.body.innerText.includes('查询条件尚未应用')`, 'pending sort explicit');
  assert.ok(await evaluate(`document.querySelector('.kernel-freshness-strip').textContent.includes('公开榜前 50 条')`),'scope reflects loaded query');
  await click('button','应用并获取结果');
  await waitFor(`!document.body.innerText.includes('查询条件尚未应用') && document.querySelector('.kernel-freshness-strip').textContent.includes('当前查询')`, 'applied sort scope');
  await goto('竞赛工作台');
  await waitFor(`document.querySelector('.notification-center-trigger')`, 'notification entry');
  await evaluate(`document.querySelector('.notification-center-trigger').click()`);
  await waitFor(`document.querySelector('.notification-center-modal')`, 'notification modal');
  await click('.notification-center-modal [role=tab]','推送消息样式预览');
  await waitFor(`document.body.innerText.includes('均为演示数据')`, 'preview labeled');
  await click('.notification-center-modal [role=tab]','投递概况');
  await waitFor(`document.body.innerText.includes('event-demo')&&document.body.innerText.includes('模拟投递失败')`, 'delivery event history');
  console.log('UX UI passed: global race, run results, immediate refresh, 1/3 agents, missing cutoffs, mobile layout, candidate races/errors, history dates, archive filters/pages, sort scope, notification sample/history.');
  await send('Browser.close');
}catch(error){
  console.error(error); process.exitCode=1;
}finally{
  if(socket?.readyState===WebSocket.OPEN) socket.send(JSON.stringify({id:999999,method:'Browser.close'}));
  await delay(800);
  socket?.close();
  if(browser?.exitCode===null)browser.kill();
  server.closeAllConnections();
  await new Promise(resolve=>server.close(resolve));
  const checked=resolve(profile);
  assert.ok(checked.startsWith(resolve(tmpdir())+ (process.platform==='win32'?'\\':'/')));
  await rm(checked,{recursive:true,force:true,maxRetries:5,retryDelay:200}).catch(()=>console.warn('Temporary browser profile still in use; retained for cleanup.'));
}
