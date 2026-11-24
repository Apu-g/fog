// Run while ./start.sh is running: node tests/e2e-smoke.js
import assert from 'node:assert/strict';
const base='http://127.0.0.1:'+(process.env.DASH_PORT||3000);
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function request(path,payload){
 const response=await fetch(base+path,{method:payload?'POST':'GET',
  headers:payload?{'content-type':'application/json'}:undefined,
  body:payload?JSON.stringify(payload):undefined,signal:AbortSignal.timeout(3000)});
 if(!response.ok)throw Error(path+' '+response.status+' '+await response.text());
 const type=response.headers.get('content-type')||'';
 return type.includes('application/json')?response.json():response.text();
}
async function eventually(condition,label,timeout=8000){
 const start=Date.now();
 while(Date.now()-start<timeout){
  const data=await request('/api/state');
  if(condition(data))return data;
  await sleep(240);
 }
 throw Error('Timed out: '+label);
}
const note=s=>console.log('  ✓ '+s);
try{
 const html=await request('/');
 assert.match(html,/AgroFog AI/);
 const initial=await eventually(s=>s.localNodesOnline===3&&s.cloudOnline,'all services online');
 assert.equal(initial.nodes.length,3);
 note('HTML loads, all 3 autonomous processes and cloud are healthy');

 const manualReading={moisture:13,temperature:40,humidity:25,rain:0};
 const injected=await request('/api/node',{id:'east',type:'inject',value:manualReading});
 assert.ok(injected.traceId);
 const recorded=await eventually(s=>{
  const t=s.nodes[1].traces?.find(t=>t.id===injected.traceId);
  return t?.cloud?.status==='delivered' && Object.values(t.peers||{}).filter(p=>p.status==='delivered').length===2;
 },'end-to-end trace cloud and 2 peer acknowledgements');
 const trace=recorded.nodes[1].traces.find(t=>t.id===injected.traceId);
 assert.deepEqual(trace.reading,manualReading);
 assert.ok(trace.stages.some(st=>st.phase==='inference'));
 assert.ok(trace.stages.some(st=>st.phase==='pump'));
 assert.ok(trace.stages.some(st=>st.phase==='cloud'));
 assert.ok(recorded.cloud.history.some(p=>p.traceId===injected.traceId));
 assert.equal(recorded.nodes[1].pump,true);
 assert.equal(recorded.nodes[1].scenario,'custom');
 note('Manual reading passes local AI, pump, peer HTTP and actual cloud ACK');

 const invalid=await fetch(base+'/api/node',{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({id:'east',type:'inject',value:{...manualReading,moisture:130}})});
 assert.equal(invalid.status,400);
 note('Bad manual input rejected with HTTP 400');

 await request('/api/node',{id:'north',type:'scenario',value:'drought'});
 const dry=await eventually(s=>s.nodes[0].scenario==='drought'&&s.nodes[0].pump,'north drought AI pump on');
 assert.ok(dry.nodes[0].decision.probability>.53);
 assert.notEqual(dry.nodes[1].scenario,'drought');
 const originalTick=dry.nodes[0].tick;
 note('Drought activates North Field pump independently');

 await request('/api/system',{action:'stop',service:'cloud'});
 await eventually(s=>!s.cloudOnline,'cloud failure');
 await sleep(1800);
 const disconnected=await request('/api/state');
 assert.equal(disconnected.cloudOnline,false);
 assert.equal(disconnected.localNodesOnline,3);
 assert.ok(disconnected.nodes[0].tick>originalTick);
 assert.ok(disconnected.nodes[0].queuedPackets>0,'local telemetry must buffer during outage');
 note('Cloud process physically stops; fog AI keeps ticking');

 const offlineInjection=await request('/api/node',{id:'north',type:'inject',
  value:{moisture:11,temperature:31,humidity:90,rain:18}});
 const queued=await eventually(s=>s.nodes[0].traces?.find(t=>t.id===offlineInjection.traceId)?.cloud.status==='queued','trace queued during outage');
 assert.equal(queued.nodes[0].pump,false);
 assert.equal(queued.cloudOnline,false);
 note('Rain override stops local pump; trace saved in offline outbox');

 await request('/api/node',{id:'north',type:'scenario',value:'rain'});
 const rain=await eventually(s=>s.nodes[0].scenario==='rain'&&!s.nodes[0].pump,'local rain lockout');
 assert.equal(rain.cloudOnline,false);
 note('Local rain safety stops pump while cloud is offline');

 await request('/api/system',{action:'start',service:'cloud'});
 await eventually(s=>s.cloudOnline&&s.cloud.activeNodes===3,'cloud recovery');
 await eventually(s=>s.nodes.every(n=>n.queuedPackets===0),'queued cloud telemetry replay');
 const replayed=await eventually(s=>s.nodes[0].traces?.find(t=>t.id===offlineInjection.traceId)?.cloud.status==='delivered','offline trace cloud ACK');
 assert.ok(replayed.cloud.history.some(p=>p.traceId===offlineInjection.traceId));
 note('Offline-injected packet has persisted ACK after reconnection');
 note('Cloud returns, fog nodes replay their buffered telemetry');

 await request('/api/node',{id:'east',type:'scenario',value:'sensor-fault'});
 const fault=await eventually(s=>s.nodes[1].decision?.status==='sensor-fault','sensor fault');
 assert.equal(fault.nodes[1].pump,false);
 note('Bad sensor data fails safe in fog node 02');

 await request('/api/speed',{speed:4});
 await eventually(s=>s.nodes.every(n=>n.speed===4),'4x simulation speed');
 await request('/api/speed',{speed:1});
 note('Simulation speed propagates to all local controllers');

 await request('/api/system',{action:'stop',service:'south'});
 const off=await eventually(s=>s.localNodesOnline===2,'south process shutdown');
 assert.equal(off.nodes[2].offline,true);
 await request('/api/system',{action:'start',service:'south'});
 await eventually(s=>s.localNodesOnline===3,'south process recovery');
 note('Individual node fails and restarts without stopping other nodes');

 await request('/api/node',{id:'north',type:'mode',value:'manual'});
 await request('/api/node',{id:'north',type:'pump',value:true});
 let manual=await request('/api/state');
 assert.equal(manual.nodes[0].mode,'manual');
 assert.equal(manual.nodes[0].pump,true);
 await request('/api/node',{id:'north',type:'mode',value:'auto'});
 const restored=await eventually(s=>s.nodes[0].mode==='auto'&&!s.nodes[0].pump,'local AI resumed');
 note('Manual pump override and AI autonomy restore behave correctly');

 console.log('\nAll end-to-end demonstration checks passed.');
}finally {
 try{
  await request('/api/system',{action:'reset',service:'all'});
  console.log('Simulation reset requested.');
 }catch(e){console.error('Reset problem:',e.message);}
}
