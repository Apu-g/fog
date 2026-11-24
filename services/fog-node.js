import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { trainModel } from '../lib/model.js';
import { makeZone, applyScenario, simulateTick, snapshot, addEvent, injectReading, recordTraceStage } from '../lib/simulator.js';

const id = process.argv[2];
const port = Number(process.argv[3]);
const seed = { north:11, east:29, south:53 }[id];
if (!seed || !Number.isInteger(port)) { console.error('Usage: fog-node.js <north|east|south> <port>'); process.exit(2); }
const model = trainModel(seed);
let zone = makeZone(id);
let synced = false;
const pendingTelemetry=[];
let flushing=false;
let interval;
let intervalMs = 1400;
const peers = {north:4201,east:4202,south:4203};

function respond(res, code, data) {
  res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});
  res.end(JSON.stringify(data));
}
function body(req) {
  return new Promise((resolve,reject) => {
    let text='';
    req.on('data',chunk=>{text+=chunk; if(text.length>12000){reject(new Error('Body too large'));req.destroy();}});
    req.on('end',()=>{try{resolve(JSON.parse(text||'{}'));}catch{reject(new Error('Invalid JSON'));}});
    req.on('error',reject);
  });
}
async function post(port, path, payload) {
  const response = await fetch('http://127.0.0.1:'+port+path,{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),signal:AbortSignal.timeout(650)
  });
  if (!response.ok) throw new Error('Request refused');
  return response.json();
}
async function flushTelemetry(){
 if(flushing)return;
 flushing=true;
 try {
  while(pendingTelemetry.length){
   const packet=pendingTelemetry[0];
   await post(4100,'/ingest',packet);
   pendingTelemetry.shift();
   synced=true;
   if(packet.traceId){
     const trace=zone.traces.find(t=>t.id===packet.traceId);
     if(trace && trace.cloud.status!=='delivered'){
       trace.cloud={status:'delivered',time:Date.now()};
       recordTraceStage(trace,'cloud','Cloud aggregator acknowledged telemetry receipt');
     }
   }
  }
 }catch {
   synced=false;
   for(const packet of pendingTelemetry){
     if(!packet.traceId)continue;
     const trace=zone.traces.find(t=>t.id===packet.traceId);
     if(trace && trace.cloud.status==='pending'){
       trace.cloud={status:'queued',time:Date.now()};
       recordTraceStage(trace,'queue','Cloud unreachable; message retained in local outbox');
     }
   }
 }
 finally{flushing=false;}
}
async function communicate(trace=null) {
  const summary = {id:zone.id,label:zone.label,crop:zone.crop,moisture:zone.moisture,temperature:zone.temperature,
    pump:zone.pump,waterLiters:zone.waterLiters,tick:zone.tick,decision:zone.modelDecision?.status,receivedAt:Date.now(),
    ...(trace?{traceId:trace.id}:{})};
  pendingTelemetry.push(summary);
  if(pendingTelemetry.length>600)pendingTelemetry.shift(); // bounded local memory outbox
  void flushTelemetry();
  if(trace || zone.tick % 3 === 0) {
    for(const [peerId,peerPort] of Object.entries(peers)) {
      if(peerId === id) continue;
      if(trace)trace.peers[peerId]={status:'pending',time:Date.now()};
      post(peerPort,'/peer',{...summary,time:Date.now()}).then(()=>{
        if(trace){trace.peers[peerId]={status:'delivered',time:Date.now()};
          recordTraceStage(trace,'peer','Peer fog node '+peerId+' acknowledged direct packet');}
      }).catch(()=>{
        delete zone.peerReadings[peerId];
        if(trace){trace.peers[peerId]={status:'unreachable',time:Date.now()};
          recordTraceStage(trace,'peer','Peer fog node '+peerId+' unreachable');}
      });
    }
  }
}
function tick(trace=null) {
  simulateTick(zone,model);
  if(trace){
    trace.decision={...zone.modelDecision};
    trace.pump=zone.pump;
    recordTraceStage(trace,'inference','Local model predicted '+Math.round(trace.decision.probability*100)+'% irrigation demand');
    recordTraceStage(trace,'pump',zone.pump?'Local pump switched ON':'Local pump held OFF');
  }
  communicate(trace);
}
function schedule() {
  clearInterval(interval);
  interval=setInterval(tick,intervalMs);
}
const server=http.createServer(async(req,res)=>{
  const pathname=new URL(req.url,'http://localhost').pathname;
  if (req.method==='GET' && pathname==='/health') return respond(res,200,{ok:true,node:id,pid:process.pid,localAI:true});
  if (req.method==='GET' && pathname==='/state') return respond(res,200,{...snapshot(zone,model,synced),pid:process.pid,queuedPackets:pendingTelemetry.length});
  if(req.method!=='POST') return respond(res,404,{error:'Not found'});
  try{
    const data=await body(req);
    if(pathname==='/peer'){
      if(!peers[data.id]||data.id===id) return respond(res,400,{error:'Invalid peer'});
      zone.peerReadings[data.id]={id:data.id,label:String(data.label||''),temperature:Number(data.temperature)||0,
        moisture:data.moisture,decision:String(data.decision||''),traceId:typeof data.traceId==='string'?data.traceId:null,time:Date.now()};
      if(typeof data.traceId==='string' && data.traceId.length<90) addEvent(zone,'telemetry','Direct packet received from '+data.id+' ('+data.traceId.slice(0,8)+')');
      return respond(res,200,{ok:true});
    }
    if(pathname==='/control'){
      if(data.type==='inject'){
        const trace=injectReading(zone,data.value,randomUUID());
        tick(trace);
        return respond(res,200,{ok:true,traceId:trace.id,state:snapshot(zone,model,synced)});
      }
      if(data.type==='scenario') {
        applyScenario(zone,data.value);
        tick();
      } else if(data.type==='mode') {
        if(!['auto','manual'].includes(data.value)) return respond(res,400,{error:'Invalid mode'});
        zone.mode=data.value;
        addEvent(zone,'control',zone.mode==='auto'?'AI autonomy restored':'Manual pump control enabled');
        tick();
      } else if(data.type==='pump') {
        if(zone.mode!=='manual'||typeof data.value!=='boolean') return respond(res,400,{error:'Enable manual mode first'});
        zone.manualPump=data.value;
        addEvent(zone,'control',data.value?'Pump switched ON manually':'Pump switched OFF manually');
        tick();
      } else if(data.type==='speed'){
        if(![1,2,4].includes(data.value))return respond(res,400,{error:'Invalid speed'});
        zone.speed=data.value;
        intervalMs=Math.round(1400/data.value);
        schedule();
        addEvent(zone,'system','Simulation speed set to '+data.value+'×');
      } else if(data.type==='reset'){
        zone=makeZone(id); zone.modelDecision=null; tick();
      } else return respond(res,400,{error:'Unknown control'});
      return respond(res,200,{ok:true,state:snapshot(zone,model,synced)});
    }
    return respond(res,404,{error:'Not found'});
  }catch(e){respond(res,400,{error:e.message});}
});
server.listen(port,'127.0.0.1',()=>{console.log('[fog:'+id+'] PID '+process.pid+' · port '+port+' · AI accuracy '+model.validationAccuracy+'%');tick();schedule();});
function shutdown(){clearInterval(interval);server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),1500).unref();}
process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
