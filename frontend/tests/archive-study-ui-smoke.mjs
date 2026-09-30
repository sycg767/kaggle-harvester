import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, extname } from 'node:path';
import { spawn } from 'node:child_process';

// Run after npm run build. Uses an isolated headless Edge profile and mocked fetch.
const dist = resolve('dist');
const profile = await mkdtemp(join(tmpdir(), 'harvester-study-ui-'));
const injection = `<script>
const health={status:'ok',ready:true,kaggle_cli:true,token_configured:true,default_competition:'example',archive:{total_archives:2,unique_kernels:1},auto_archive:{},cache:{}};
let corrupt=false;
let study={status:'unread',tags:[],notes:'',updated_at:null},saved=null;
const archive=(id,version)=>({id,ref:'owner/notebook',title:'Test Notebook',author:'owner',competition:'example',version_number:version,public_score:version/10,archived_at:'2026-10-01T00:00:00Z',path:'/server/archives/'+id,size_bytes:100,study,...(corrupt?{study_error:'研究记录文件损坏'}:{})});
window.fetch=async(url,init)=>{
 const path=String(url);let data=[];
 if(path==='/api/health')data=health;
 else if(path.startsWith('/api/competition?'))data={id:'example',title:'Example'};
 else if(path==='/api/archives')data=[archive('one',1),archive('two',2)];
 else if(path.endsWith('/metadata'))data={metadata:{},input_sources:{}};
 else if(path.endsWith('/study')){if(init?.method==='PUT'){saved=JSON.parse(init.body);study={...saved,updated_at:'2026-10-01T01:00:00Z'};}data=study;}
 else if(path.endsWith('/preview'))data={archive_id:'one',filename:'notebook.ipynb',content:'<img src=x onerror=window.previewExecuted=true>',truncated:false};
 else if(path.includes('/compare?'))data={archive_id:'one',other_id:'two',diff:'-old_value +new_value',truncated:false};
 return new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}});
};
const result={};
const pause=(ms=50)=>new Promise(resolve=>setTimeout(resolve,ms));
async function waitFor(fn,label){for(let n=0;n<150;n++){const value=fn();if(value)return value;await pause();}throw new Error(label);}
function clickText(selector,text){const node=[...document.querySelectorAll(selector)].find(node=>node.textContent.replaceAll(' ','').trim()===text);if(!node)throw new Error('Missing '+text);node.click();}
(async()=>{try{
 await waitFor(()=>document.querySelector('#archive-study-notes'),'deep link details');
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
 clickText('[role=tab]','研究记录');await pause();
 const notes=document.querySelector('#archive-study-notes');
 Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(notes,'My reproducibility notes');
 notes.dispatchEvent(new Event('input',{bubbles:true}));await pause();
 clickText('.archive-modal-footer button','关闭');
 await waitFor(()=>document.querySelector('.ant-modal-confirm'),'unsaved prompt');
 result.unsavedPrompt=document.querySelector('.ant-modal-confirm').textContent.includes('研究记录尚未保存');
 clickText('.ant-modal-confirm button','继续编辑');await pause(400);
 clickText('.archive-detail-modal button','保存研究记录');
 await waitFor(()=>saved?.notes==='My reproducibility notes','save request');await pause();
 result.saved=saved.status==='unread'&&saved.notes==='My reproducibility notes';
 clickText('.archive-modal-footer button','关闭');await pause(400);
 result.closed=!new URL(location.href).searchParams.has('archive');
 corrupt=true;window.dispatchEvent(new Event('harvester:archives-changed'));
 await waitFor(()=>document.body.textContent.includes('研究记录无法读取'),'corruption alert');
 result.corruptionVisible=document.body.textContent.includes('状态无法读取');
 const filter=document.querySelector('input[aria-label="按研究状态筛选"]');
 filter.closest('.ant-select').querySelector('.ant-select-selector').dispatchEvent(new MouseEvent('mousedown',{bubbles:true}));
 await waitFor(()=>[...document.querySelectorAll('.ant-select-item-option')].some(n=>n.textContent==='未读'),'unread filter option');
 [...document.querySelectorAll('.ant-select-item-option')].find(n=>n.textContent==='未读').click();await pause();
 result.corruptNotUnread=!document.querySelector('.archive-table .ant-table-row');
}catch(error){result.error=String(error);}finally{document.body.setAttribute('data-study-result',JSON.stringify(result));}})();
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
  const browser=spawn(edge,['--headless=new','--disable-gpu','--no-first-run','--virtual-time-budget=20000',`--user-data-dir=${profile}`,'--dump-dom',`http://127.0.0.1:${server.address().port}/archives?archive=one`],{windowsHide:true});
  let dom='';browser.stdout.on('data',chunk=>dom+=chunk);browser.stderr.resume();
  const code=await new Promise((resolve,reject)=>{browser.on('close',resolve);browser.on('error',reject);});
  assert.equal(code,0);
  const result=dom.match(/data-study-result="([^"]+)"/);
  assert.ok(result,'browser study scenario did not complete');
  const actual=JSON.parse(result[1].replaceAll('&quot;','"').replaceAll('&amp;','&'));
  assert.deepEqual(actual,{deepLink:true,safePreview:true,diff:true,unsavedPrompt:true,saved:true,closed:true,corruptionVisible:true,corruptNotUnread:true});
  console.log('Archive study UI smoke passed:',actual);
}finally{
  await new Promise(resolve=>server.close(resolve));
  const checked=resolve(profile);
  assert.ok(checked.startsWith(resolve(tmpdir())+ (process.platform==='win32'?'\\':'/')));
  await rm(checked,{recursive:true,force:true,maxRetries:5,retryDelay:200});
}
