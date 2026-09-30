import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, extname } from 'node:path';
import { spawn } from 'node:child_process';

// Run after npm run build. Uses an isolated headless Edge profile and mocked fetch.
const dist = resolve('dist');
const profile = await mkdtemp(join(tmpdir(), 'harvester-health-ui-'));
const injection = `<script>
const health={status:'ok',ready:true,kaggle_cli:true,token_configured:true,
  default_competition:'example',archive:{total_archives:0,unique_kernels:0},auto_archive:{},cache:{}};
let requests=0,active=0,maxActive=0,recovered=false;
window.fetch=async(url)=>{
  if(String(url)==='/api/health'){
    const n=++requests;active++;maxActive=Math.max(active,maxActive);
    return new Promise(resolve=>setTimeout(()=>{active--;
      resolve(n===2?new Response(JSON.stringify(health)):new Response('upstream failed',{status:502}));
    },300));
  }
  return new Response(JSON.stringify(String(url).startsWith('/api/competition?')?{id:'example',title:'Example'}:[]));
};
const burst=()=>{for(let i=0;i<5;i++){
  window.dispatchEvent(new Event('online'));window.dispatchEvent(new Event('focus'));
  document.querySelector('button[aria-label="刷新服务状态"]')?.click();
}};
const begin=setInterval(()=>{
  if(!requests)return;clearInterval(begin);burst();
  setTimeout(()=>{recovered=document.body.textContent.includes('服务正常');burst();},7400);
  setTimeout(()=>document.body.setAttribute('data-health-result',JSON.stringify({requests,maxActive,recovered,
    preserved:document.body.textContent.includes('当前界面保留最近一次成功获取的数据'),
    blocked:document.body.textContent.includes('无法连接到后端服务')})),8300);
},10);
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
  const browser=spawn(edge,['--headless=new','--disable-gpu','--no-first-run','--virtual-time-budget=10000',`--user-data-dir=${profile}`,'--dump-dom',`http://127.0.0.1:${server.address().port}/kernels`],{windowsHide:true});
  let dom='';browser.stdout.on('data',chunk=>dom+=chunk);browser.stderr.resume();
  const code=await new Promise((resolve,reject)=>{browser.on('close',resolve);browser.on('error',reject);});
  assert.equal(code,0);
  const result=dom.match(/data-health-result="([^"]+)"/);
  assert.ok(result,'browser health scenario did not complete');
  const actual=JSON.parse(result[1].replaceAll('&quot;','"').replaceAll('&amp;','&'));
  assert.deepEqual(actual,{requests:3,maxActive:1,recovered:true,preserved:true,blocked:false});
  console.log('Health UI recovery and overlapping-trigger test passed:',actual);
}finally{
  await new Promise(resolve=>server.close(resolve));
  const checked=resolve(profile);
  assert.ok(checked.startsWith(resolve(tmpdir())+ (process.platform==='win32'?'\\':'/')));
  await rm(checked,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
