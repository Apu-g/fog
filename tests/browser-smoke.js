// Optional Chrome browser interaction test. Uses built-in Node WebSocket (Node 22+).
// Run with the AgroFog launcher active: node tests/browser-smoke.js
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const base='http://127.0.0.1:'+(process.env.DASH_PORT||3000);
const chromePath=process.env.CHROME_BIN||'google-chrome-stable';
const profile=await mkdtemp(path.join(os.tmpdir(),'agrofog-browser-'));
let chrome,ws,id=1;
const pending=new Map();
async function freePort(){
 const srv=net.createServer();
 await new Promise((resolve,reject)=>srv.once('error',reject).listen(0,'127.0.0.1',resolve));
 const p=srv.address().port;
 await new Promise(resolve=>srv.close(resolve));
 return p;
}
async function devtools(port){
 for(let i=0;i<55;i++){
  try{
   const res=await fetch('http://127.0.0.1:'+port+'/json/list',{signal:AbortSignal.timeout(700)});
   const tabs=await res.json();
   const tab=tabs.find(x=>x.type==='page'&&x.url.includes('127.0.0.1:3000'))||tabs.find(x=>x.type==='page');
   if(tab)return tab.webSocketDebuggerUrl;
  }catch{}
  await sleep(150);
 }
 throw Error('Chrome debugging endpoint did not start');
}
async function connect(url){
 ws=new WebSocket(url);
 await new Promise((resolve,reject)=>{
  ws.addEventListener('open',resolve,{once:true});
  ws.addEventListener('error',reject,{once:true});
 });
 ws.addEventListener('message',event=>{
  const msg=JSON.parse(event.data);
  if(msg.id && pending.has(msg.id)){
   const callback=pending.get(msg.id);
   pending.delete(msg.id);
   callback(msg);
  }
 });
}
function cdp(method,params={}){
 return new Promise((resolve,reject)=>{
  const ref=id++;
  const timer=setTimeout(()=>{pending.delete(ref);reject(Error('CDP timed out: '+method));},5000);
  pending.set(ref,(result)=>{
   clearTimeout(timer);
   if(result.error)reject(Error(result.error.message));
   else resolve(result.result);
  });
  ws.send(JSON.stringify({id:ref,method,params}));
 });
}
async function evalJS(expression){
 const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
 if(r.exceptionDetails)throw Error('Browser JS threw: '+r.exceptionDetails.text);
 return r.result?.value;
}
async function waitFor(expression,label){
 for(let i=0;i<38;i++){
  if(await evalJS(expression))return;
  await sleep(160);
 }
 throw Error('Browser UI timed out waiting for '+label);
}
const click=async(selector)=>{
 const expression='(()=>{const b=document.querySelector('+JSON.stringify(selector)+');if(!b)return false;b.click();return true})()';
 assert.equal(await evalJS(expression),true,'missing UI control: '+selector);
};
const note=text=>console.log('  ✓ '+text);
try{
 const port=await freePort();
 chrome=spawn(chromePath,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
  '--remote-debugging-port='+port,'--user-data-dir='+profile,'--window-size=1440,950',base],{stdio:'ignore'});
 await connect(await devtools(port));
 await cdp('Runtime.enable');
 await waitFor('document.body.innerText.includes("Your living farm")','overview');
 note('Homepage mounted inside real Chrome');

 await click('[data-page="network"]');
 await waitFor('document.body.innerText.includes("Live network topology")','network topology');
 await waitFor('document.body.innerText.includes("Peer links: 2")','peer-to-peer status');
 note('Navigation and real peer-to-peer indicators are visible');

 await click('[data-action="cloud-off"]');
 await waitFor('document.body.innerText.includes("Cloud offline")','cloud failure indicator');
 assert.ok(await evalJS('document.body.innerText.includes("Local AI operational")'));
 note('Cloud button changes live process state; nodes remain operational');

 await click('[data-action="cloud-on"]');
 await waitFor('document.body.innerText.includes("Cloud connected")','cloud reconnect');
 note('Cloud reconnect UI updates');

 await click('[data-page="overview"]');
 await click('[data-scenario="drought"]');
 await waitFor('document.body.innerText.includes("Irrigation running")','local irrigation');
 note('Drought button triggers visible local irrigation decision');

 await click('[data-select="east"]');
 await waitFor('document.body.innerText.includes("East Orchard")','zone selection');
 await click('[data-scenario="sensor-fault"]');
 await waitFor('document.body.innerText.includes("Sensor validation failed")','sensor fault');
 note('Field selection and sensor fault message update correctly');

 await click('[data-page="guide"]');
 await waitFor('document.body.innerText.includes("Demonstration sequence")','guide');
 note('Guided demonstration page renders');

 await click('[data-page="flow"]');
 await waitFor('document.querySelector("#flow-form") && document.querySelector("#flow-map")','data flow lab');
 if(process.env.AGROFOG_SCREENSHOT){
  const capture=await cdp('Page.captureScreenshot',{format:'png'});
  await writeFile(process.env.AGROFOG_SCREENSHOT,Buffer.from(capture.data,'base64'));
 }
 await click('[data-flow-preset="drought"]');
 assert.equal(await evalJS('document.querySelector("#flow-field-moisture").value'), '14');
 await click('#flow-form button[type="submit"]');
 await waitFor('document.querySelector(".flow-trace-id")?.textContent.length > 8','trace ID displayed');
 await waitFor('document.querySelector("#flow-packets circle.flow-packet")','animated sensor packet');
 const packetX=await evalJS('document.querySelector("#flow-packets circle.flow-packet").getAttribute("cx")');
 await sleep(110);
 const packetXMoved=await evalJS('document.querySelector("#flow-packets circle.flow-packet")?.getAttribute("cx")');
 assert.ok(packetXMoved && packetX!==packetXMoved,'packet must visibly move along its path');
 await waitFor('document.querySelectorAll(".flow-timeline-item").length >= 4','local stages and HTTP ACKs');
 assert.ok(await evalJS('document.querySelector("#flow-map")?.getAttribute("viewBox") === "0 0 940 400"'));
 note('Input preset, actual sensor injection, trace timeline and animated graph render');

 await evalJS('(()=>{const el=document.querySelector("#flow-field-moisture");el.value="22";el.focus();})()');
 await sleep(1250);
 assert.equal(await evalJS('document.querySelector("#flow-field-moisture").value'),'22');
 assert.equal(await evalJS('document.activeElement?.id'),'flow-field-moisture');
 note('Live polling preserves active manual input and keyboard focus');

 await click('[data-flow-action="cloud-toggle"]');
 await waitFor('document.querySelector("#flow-cloud-status")?.textContent.includes("Cloud offline")','flow lab cloud outage');
 await click('[data-flow-preset="rain"]');
 await click('#flow-form button[type="submit"]');
 await waitFor('document.querySelector(".flow-trace-status.buffering")?.textContent.includes("Buffered")','packet buffering');
 assert.ok(await evalJS('document.querySelector("#flow-node-cloud")?.classList.contains("is-offline")'));
 note('Offline cloud receives no packet; interface reports real queued trace');

 await click('[data-flow-action="cloud-toggle"]');
 await waitFor('document.querySelector(".flow-trace-status.ok")?.textContent.includes("acknowledged")','cloud ACK on replay');
 note('Cloud reconnection updates original trace delivery from queue to acknowledged');

 await cdp('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
 await sleep(300);
 const geometry=await evalJS('({width:document.documentElement.scrollWidth,viewport:window.innerWidth})');
 assert.ok(geometry.width<=geometry.viewport+3,'horizontal overflow on mobile: '+JSON.stringify(geometry));
 note('390px mobile layout has no page-wide horizontal overflow');
 console.log('\nChrome browser interaction checks passed.');
}finally{
 try{await fetch(base+'/api/system',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'reset',service:'all'})});}catch{}
 try{ws?.close();}catch{}
 if(chrome){chrome.kill('SIGTERM');await sleep(450);if(chrome.exitCode===null)chrome.kill('SIGKILL');}
 await rm(profile,{recursive:true,force:true,maxRetries:3,retryDelay:180}).catch(()=>{});
}
