import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, extname } from 'node:path';
import { spawn } from 'node:child_process';

// Run after npm run build. Uses an isolated headless Edge profile and mocked fetch.
const project = process.cwd();
const fixture = await mkdtemp(join(project, 'tests', '.clawbot-ui-'));
const dist = join(fixture, 'dist');
const profile = await mkdtemp(join(tmpdir(), 'harvester-clawbot-ui-'));
await writeFile(join(fixture,'index.html'), '<html><head><meta charset="UTF-8"></head><body><div id="root"></div><script type="module" src="/entry.tsx"></script></body></html>');
await writeFile(join(fixture,'entry.tsx'), `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {App} from 'antd';
import {ClawbotModal} from '../../src/components/simulation/ClawbotModal';
const bot={enabled:true,is_online:true,configured:true,gateway_ok:true,wechat_running:true,business_api_ok:true,delivery_configured:false,checked_at:new Date().toISOString(),status_source:'host_snapshot'};
function Fixture(){const [result,setResult]=useState(null);return <App><ClawbotModal open onClose={()=>{}} status={{clawbot:bot}} testing={false} testResult={result} onTest={async()=>setResult({success:false,message:'TCP 不可达，不代表微信停止运行',candidates:[],configured:true,status:{...bot,gateway_reachable:false}})}/></App>}
createRoot(document.getElementById('root')).render(<Fixture/>);
`);
await writeFile(join(fixture,'vite.config.mjs'), `export default {root:${JSON.stringify(fixture)},build:{outDir:${JSON.stringify(dist)},emptyOutDir:true}};`);
const build=spawn(process.execPath,[join(project,'node_modules/vite/bin/vite.js'),'build','--config',join(fixture,'vite.config.mjs')],{windowsHide:true,stdio:'ignore'});
assert.equal(await new Promise((resolve,reject)=>{build.on('close',resolve);build.on('error',reject);}),0,'fixture build');
const injection = `<script>
window.__errors=[];window.addEventListener('error',e=>window.__errors.push(e.message));
const pause=()=>new Promise(resolve=>setTimeout(resolve,50));
const run=async()=>{const result={};try{

 result.initialPlugin=document.querySelector('.ant-descriptions')?.textContent.includes('运行中');
 [...document.querySelectorAll('button')].find(b=>b.textContent.includes('刷新状态')).click();
 for(let i=0;i<100&&!document.body.textContent.includes('不可达');i++)await pause();
 const rows=[...document.querySelectorAll('.ant-descriptions-row')];
 result.pluginStillRunning=rows.find(r=>r.textContent.includes('微信插件'))?.textContent.includes('运行中');
 result.tcpFailed=document.body.textContent.includes('TCP 不可达，不代表微信停止运行');
 result.noGuessedModel=rows.find(r=>r.textContent.includes('模型'))?.textContent.includes('未记录');
}catch(error){result.error=String(error);result.browserErrors=window.__errors;}document.body.setAttribute('data-clawbot-result',JSON.stringify(result));};
const observer=new MutationObserver(()=>{if([...document.querySelectorAll('button')].some(b=>b.textContent.includes('刷新状态'))){observer.disconnect();run();}});observer.observe(document.documentElement,{subtree:true,childList:true});
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
try{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const edge=process.env.EDGE_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  const browser=spawn(edge,['--headless=new','--disable-gpu','--no-first-run','--virtual-time-budget=30000',`--user-data-dir=${profile}`,'--dump-dom',`http://127.0.0.1:${server.address().port}/kernels`],{windowsHide:true});
  let dom='';browser.stdout.on('data',chunk=>dom+=chunk);browser.stderr.resume();
  const code=await new Promise((resolve,reject)=>{browser.on('close',resolve);browser.on('error',reject);});
  assert.equal(code,0);
  const result=dom.match(/data-clawbot-result="([^"]+)"/);
  assert.ok(result,'browser clawbot scenario did not complete');
  const actual=JSON.parse(result[1].replaceAll('&quot;','"').replaceAll('&amp;','&'));

  assert.deepEqual(actual,{initialPlugin:true,pluginStillRunning:true,tcpFailed:true,noGuessedModel:true});
  console.log('Clawbot layered diagnostic UI passed:',actual);
}finally{
  await new Promise(resolve=>server.close(resolve));
  const checked=resolve(profile);
  assert.ok(checked.startsWith(resolve(tmpdir())+ (process.platform==='win32'?'\\':'/')));
  await rm(checked,{recursive:true,force:true,maxRetries:5,retryDelay:200});
  assert.ok(resolve(fixture).startsWith(resolve(project,'tests')+ (process.platform==='win32'?'\\':'/')));
  await rm(fixture,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
