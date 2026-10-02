import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, extname } from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

// Run after npm run build. Uses an isolated headless Edge profile and mocked fetch.
const dist = resolve('dist');
const profile = await mkdtemp(join(tmpdir(), 'harvester-source-ui-'));
const injection = `<script>
const health={status:'ok',ready:true,kaggle_cli:true,token_configured:true,default_competition:'example',archive:{total_archives:2,unique_kernels:1},auto_archive:{},cache:{}};
let retiredRequests=0;
const archive=(id,version)=>({id,ref:'owner/notebook',title:'Test Notebook',author:'owner',competition:'example',version_number:version,public_score:version/10,archived_at:'2026-10-01T00:00:00Z',path:'/server/archives/'+id,size_bytes:100});
window.fetch=async(url,init)=>{
 const path=String(url);let data=[];
 if(path==='/api/health')data=health;
 else if(path.startsWith('/api/competition?'))data={id:'example',title:'Example'};
 else if(path==='/api/archives')data=[archive('one',1),archive('two',2)];
 else if(path.endsWith('/metadata'))data={metadata:{},input_sources:{}};
 else if(path.endsWith('/study')||path.endsWith('/studies')){retiredRequests++;return new Response('',{status:404});}
 else if(path.endsWith('/preview'))data={archive_id:'one',filename:'notebook.ipynb',content:'<img src=x onerror=window.previewExecuted=true>',truncated:false};
 else if(path.includes('/compare?'))data={archive_id:'one',other_id:'two',diff:'-old_value +new_value',truncated:false};
 return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
};
const result={};
const pause=(ms=50)=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(fn,label){for(let n=0;n<150;n++){const value=fn();if(value)return value;await pause();}throw new Error(label);}
function clickText(selector,text){const node=[...document.querySelectorAll(selector)].find(node=>node.textContent.replaceAll(' ','').trim()===text);if(!node)throw new Error('Missing '+text);node.click();}
(async()=>{try{
 await waitFor(()=>document.querySelector('.archive-detail-modal pre'),'deep link details');
 result.deepLink=document.querySelector('.archive-detail-modal').textContent.includes('owner/notebook');
 clickText('[role=tab]','源码预览');
 await waitFor(()=>document.querySelector('.archive-detail-modal pre')?.textContent.includes('<img'),'preview');
 result.safePreview=!window.previewExecuted&&!document.querySelector('.archive-detail-modal pre img');
 clickText('[role=tab]','版本比较');await pause();
 const select=document.querySelector('input[aria-label="选择比较版本"]');
 if(!select)throw new Error('version selector');
 select.closest('.ant-select').querySelector('.ant-select-selector').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
 await waitFor(()=>document.querySelector('.ant-select-item-option'),'version options');
 document.querySelector('.ant-select-item-option').click();
 await waitFor(()=>[...document.querySelectorAll('.archive-detail-modal pre')].some(p=>p.textContent.includes('new_value')),'diff');
 result.diff=true;
 result.researchRemoved=!document.querySelector('#archive-study-notes')&&!document.body.textContent.includes('研究记录')&&!document.body.textContent.includes('研究状态')&&retiredRequests===0;
 clickText('.archive-modal-footer button','关闭');await pause(400);
 result.closed=!new URL(location.href).searchParams.has('archive');
}catch(error){result.error=String(error);}finally{document.body.setAttribute('data-source-result',JSON.stringify(result));}})();
</script>`;
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
      if (await evaluate(expression)) return;
      await delay(100);
    }
    throw new Error(`UI assertion timed out: ${label}\n${await evaluate('document.body.innerText')}`);
  };
  await send('Page.enable');
  await send('Page.navigate',{url:`http://127.0.0.1:${server.address().port}/archives?archive=one`});
  await waitFor(`!!document.body?.getAttribute('data-source-result')`, 'source UI scenario');
  const actual=JSON.parse(await evaluate(`document.body.getAttribute('data-source-result')`));
  assert.deepEqual(actual,{deepLink:true,safePreview:true,diff:true,researchRemoved:true,closed:true});
  console.log('Archive source UI smoke passed:',actual);
  await send('Browser.close');
}finally{
  socket?.close();
  if(browser?.exitCode===null)browser.kill();
  await new Promise(resolve=>server.close(resolve));
  const checked=resolve(profile);
  assert.ok(checked.startsWith(resolve(tmpdir())+ (process.platform==='win32'?'\\':'/')));
  await rm(checked,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
