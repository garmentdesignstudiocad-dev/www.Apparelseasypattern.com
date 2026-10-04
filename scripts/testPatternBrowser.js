// Run testOwnerUpdate.js first to generate synthetic page fixtures. Uses installed Chromium/Edge.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),{spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),fixtures=path.join(root,'private/owner-update-check');
async function run(){
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost'),name=url.pathname.slice(1);
  if(url.pathname==='/cart/count'){res.setHeader('Content-Type','application/json');return res.end('{"count":2}');}
  const file=['product','home','books','classes'].includes(name)?path.join(fixtures,name+'.html'):path.resolve(root,'public',name);
  if(!file.startsWith(path.join(root,'public')+path.sep)&&!file.startsWith(fixtures+path.sep)){res.writeHead(404);return res.end();}
  try{res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'application/javascript':'text/html');res.end(fs.readFileSync(file));}catch{res.writeHead(404);res.end();}
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+server.address().port;
 const profile=fs.mkdtempSync(path.join(require('os').tmpdir(),'pattern-browser-'));
 const child=spawn(process.env.BROWSER_BINARY||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',['--headless=new','--remote-debugging-port=0','--user-data-dir='+profile,'--disable-extensions','--no-first-run','about:blank'],{stdio:'ignore',windowsHide:true});let ws;
 try{
  let port;for(let i=0;i<100;i++){try{port=fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];break;}catch{await new Promise(r=>setTimeout(r,100));}}
  assert(port,'Browser did not start');
  const tabs=await(await fetch('http://127.0.0.1:'+port+'/json')).json();ws=new WebSocket(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.onopen=r);
  let id=0;const jobs=new Map();ws.onmessage=event=>{const m=JSON.parse(event.data);if(m.id&&jobs.has(m.id)){jobs.get(m.id)(m);jobs.delete(m.id);}};
  const call=(method,params={})=>new Promise((resolve,reject)=>{const n=++id,timer=setTimeout(()=>reject(Error('Browser timeout: '+method)),10000);jobs.set(n,m=>{clearTimeout(timer);m.error?reject(Error(m.error.message)):resolve(m.result);});ws.send(JSON.stringify({id:n,method,params}));});
  const evaluate=async expression=>{const result=await call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});assert(!result.exceptionDetails,JSON.stringify(result.exceptionDetails));return result.result.value;};
  for(const width of [320,390,1280]){
   await call('Emulation.setDeviceMetricsOverride',{width,height:900,deviceScaleFactor:1,mobile:width<900});
   for(const page of ['home','product','books','classes']){
    await call('Page.navigate',{url:origin+'/'+page});
    for(let i=0;i<50;i++){if(await evaluate('document.readyState==="complete"'))break;await new Promise(r=>setTimeout(r,100));}
    const layout=await evaluate(`(()=>{const nav=document.querySelector('#main-nav');if(innerWidth<900)document.querySelector('#nav-toggle').click();const links=[...document.querySelectorAll('.nav-auth>a')].map(a=>a.getBoundingClientRect());return {width:innerWidth,scroll:document.documentElement.scrollWidth,sameRow:links[0].top===links[1].top,navOpen:innerWidth>=900||nav.classList.contains('open'),cart:document.querySelector('#cart-count').textContent};})()`);
    if(layout.width!==width||layout.scroll>width)console.log(page,width,layout,await evaluate("[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>"+width+").map(e=>({tag:e.tagName,cls:e.className,right:e.getBoundingClientRect().right})).slice(0,20)"));assert.equal(layout.width,width);assert(layout.scroll<=width,page+' overflow at '+width);assert(layout.sameRow);assert(layout.navOpen,page+' navigation did not open at '+width+'px: '+JSON.stringify(layout));assert.equal(layout.cart,'2');
    if(page==='product'){
     const result=await evaluate(`(()=>{const area=document.querySelector('[data-protected-content]'),input=document.querySelector('.pattern-size');const event=(target,type,extra={})=>{const e=type==='keydown'?new KeyboardEvent(type,{bubbles:true,cancelable:true,...extra}):new Event(type,{bubbles:true,cancelable:true});target.dispatchEvent(e);return e.defaultPrevented;};const range=document.createRange();range.selectNodeContents(document.querySelector('p[data-protected-content]'));getSelection().removeAllRanges();getSelection().addRange(range);const copy=event(document.body,'copy');getSelection().removeAllRanges();const checks={context:event(area,'contextmenu'),drag:event(area,'dragstart'),select:event(area,'selectstart'),copy,shortcut:event(area,'keydown',{key:'c',ctrlKey:true}),save:event(area,'keydown',{key:'s',ctrlKey:true}),inputContext:event(input,'contextmenu'),inputCopy:event(input,'keydown',{key:'c',ctrlKey:true}),tab:event(input,'keydown',{key:'Tab'}),watermark:getComputedStyle(document.querySelector('.preview-watermark'),'::after').content};document.querySelector('#printable-option').checked=false;document.querySelector('.pattern-file').checked=true;input.checked=true;input.dispatchEvent(new Event('input',{bubbles:true}));checks.total=document.querySelector('#pdTotal').textContent;return checks;})()`);
     for(const key of ['context','drag','select','copy','shortcut','save'])assert.equal(result[key],true,key);
     for(const key of ['inputContext','inputCopy','tab'])assert.equal(result[key],false,key);
     assert.match(result.watermark,/Apparel Easy Patterns/);assert.match(result.total,/47\.20/);
    }
    if(page==='classes')assert.equal(await evaluate(`(()=>{const select=document.querySelector('#profession');select.value='Student';select.dispatchEvent(new Event('change'));return document.querySelector('[name=studying]').required&&!document.querySelector('[name=studying]').disabled&&document.querySelector('[name=current_role]').disabled;})()`),true);
    if(width===390||width===1280){const image=await call('Page.captureScreenshot',{captureBeyondViewport:false});fs.writeFileSync(path.join(fixtures,page+'-'+width+'.png'),Buffer.from(image.data,'base64'));}
   }
  }
  console.log('PASS: 320/390/1280px layouts, mobile navigation, cart badge, account button row, live option totals, context/copy/drag/shortcut deterrents, form keyboard exemptions, visible watermarks and conditional enquiry fields.');
  await call('Browser.close');
 }finally{if(ws)ws.close();child.kill();await new Promise(r=>server.close(r));}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
