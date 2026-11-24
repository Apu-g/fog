// Data Flow Lab: instructional packet animation derived from real HTTP/AI trace receipts.
// No rendering timers manufacture backend events; the local node remains the source of truth.
const labels={north:'North Field',east:'East Orchard',south:'South Greenhouse'};
const defaults={moisture:16,temperature:38,humidity:26,rain:0};
const presets={
 drought:{moisture:14,temperature:40,humidity:25,rain:0},
 healthy:{moisture:68,temperature:27,humidity:66,rain:0},
 rain:{moisture:19,temperature:29,humidity:87,rain:18},
 heat:{moisture:28,temperature:46,humidity:20,rain:0}
};
const encode=x=>String(x??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const svgIcon=name=>'<svg aria-hidden="true"><use href="#'+name+'"></use></svg>';
const time=t=>t?new Date(t).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';
let form={...defaults}, selected='north', traceId=null, current=null, lastCloudStatus='', playing=false, playToken=0, playbackSpeed=1;
let syncApp=null, notify=null, data=null;
function fogZone(){return data?.nodes?.find(n=>n.id===selected);}
function trace(){
 const z=fogZone();
 return (z?.traces||[]).find(t=>t.id===traceId)||(!traceId?z?.traces?.[0]:null);
}
function chosenLabel(){return labels[selected]||selected;}
const serviceOnline=()=>data?.nodes?.find(n=>n.id===selected)?.offline!==true;
async function post(path,input){
 const res=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});
 const result=await res.json();
 if(!res.ok)throw Error(result.error||'Request failed');
 return result;
}
function flowNode(name,x,y,w,h,title,subtitle,iconName,extra=''){
 const cx=x+w/2;
 return '<g id="flow-node-'+name+'" class="flow-svg-node '+extra+'">'+
 '<rect x="'+x+'" y="'+y+'" width="'+w+'" height="'+h+'" rx="15" class="flow-svg-card"/>'+
 '<circle cx="'+(x+29)+'" cy="'+(y+30)+'" r="17" class="flow-node-icon"/>'+
 '<text x="'+(x+29)+'" y="'+(y+35)+'" text-anchor="middle" class="flow-mini-icon">'+encode(iconName)+'</text>'+
 '<text x="'+(x+15)+'" y="'+(y+63)+'" class="flow-node-name">'+encode(title)+'</text>'+
 '<text x="'+(x+15)+'" y="'+(y+81)+'" class="flow-node-subtitle">'+encode(subtitle)+'</text>'+
 '</g>';
}
function graph(){
 return '<div class="flow-canvas-top"><span class="flow-live-dot"></span><b>Live distributed architecture</b><span class="flow-inline-tip">Animated routes correspond to observed stages</span></div>'+
 '<div class="flow-svg-wrap"><svg id="flow-map" viewBox="0 0 940 400" role="img" aria-label="Animated sensor to fog to local AI and pump, with peer fog and cloud transmission routes">'+
 '<defs><marker id="flow-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10z" fill="#98b6a6"/></marker></defs>'+
 '<path id="flow-path-sensor" class="flow-link" d="M 195 201 L 263 201"/>'+
 '<path id="flow-path-ai" class="flow-link" d="M 431 178 L 495 115"/>'+
 '<path id="flow-path-pump" class="flow-link" d="M 674 115 L 729 115"/>'+
 '<path id="flow-path-peer" class="flow-link" d="M 431 229 L 496 301"/>'+
 '<path id="flow-path-cloud" class="flow-link cloud-path" d="M 350 258 L 350 380 L 824 380 L 824 356"/>'+
 flowNode('sensor',25,148,170,110,'Virtual sensors','4 live input values','S')+
 flowNode('fog',263,148,168,110,'Local fog node','Separate OS process','F')+
 flowNode('ai',496,62,178,109,'AI inference','On-node model','AI')+
 flowNode('pump',729,62,188,109,'Irrigation pump','Local actuator','P')+
 flowNode('peer',496,246,178,111,'Peer fog nodes','2 direct HTTP peers','↔')+
 flowNode('cloud',729,246,188,111,'Cloud aggregator','Telemetry only','C')+
 '<text x="221" y="185" class="flow-edge-label" text-anchor="middle">INPUT</text>'+
 '<text x="469" y="128" class="flow-edge-label" text-anchor="middle">AI</text>'+
 '<text x="703" y="101" class="flow-edge-label" text-anchor="middle">DECIDE</text>'+
 '<text x="474" y="280" class="flow-edge-label" text-anchor="middle">PEER</text>'+
 '<text x="583" y="370" class="flow-edge-label" text-anchor="middle">CLOUD SUMMARY</text>'+
 '<g id="flow-packets" aria-hidden="true"></g></svg></div>'+ 
 '<div class="flow-stage-bar"><span id="flow-now">Enter a reading and press Send sensor packet.</span>'+
 '<span class="flow-stage-legend"><i class="flow-key local"></i> Local processing <i class="flow-key remote"></i> HTTP transfer</span></div>';
}
function formUI(){
 return '<section class="panel flow-input-panel"><div class="panelhead"><div><h2>1. Create a sensor reading</h2><p>Control the numbers entering your fog network</p></div></div>'+
 '<form id="flow-form" class="flow-form"><label class="flow-label" for="flow-zone">Send to this farm zone</label>'+
 '<select id="flow-zone" name="zone" class="flow-select">'+Object.entries(labels).map(([id,l])=>'<option value="'+id+'" '+(id===selected?'selected':'')+'>'+encode(l)+'</option>').join('')+'</select>'+
 '<div class="flow-quick-label">Sample situations <span>or enter your own</span></div>'+
 '<div class="flow-preset-grid">'+[['drought','Drought'],['healthy','Healthy'],['rain','Rainstorm'],['heat','Heatwave']].map(([key,label])=>'<button type="button" data-flow-preset="'+key+'">'+label+'</button>').join('')+'</div>'+
 '<div class="flow-fields">'+[
 ['moisture','Soil moisture','%',0,100,1],
 ['temperature','Air temperature','°C',-10,60,1],
 ['humidity','Air humidity','%',0,100,1],
 ['rain','Rainfall','mm/h',0,100,.1]
 ].map(([key,label,unit,min,max,step])=>'<label class="flow-field"><span>'+label+'</span><span class="flow-number-wrap"><input type="number" inputmode="decimal" name="'+key+'" id="flow-field-'+key+'" min="'+min+'" max="'+max+'" step="'+step+'" required value="'+form[key]+'"><em>'+unit+'</em></span></label>').join('')+'</div>'+
 '<button class="flow-send" type="submit">'+svgIcon('play')+' Send sensor packet</button>'+
 '<div class="flow-help">These values are injected into a real local fog process. It runs ML inference and sends messages to other processes.</div>'+
 '</form></section>';
}
function selectedTraceUI(){
 const t=trace(),z=fogZone();
 if(!t)return '<div class="flow-trace-empty"><div class="flow-empty-icon">⌁</div><b>No packet captured yet</b><p>Enter sensor readings above. Each submitted packet will show its ID, local AI decision, and actual delivery acknowledgments here.</p></div>';
 const cloudStatus=t.cloud?.status||'pending';
 const ack=Object.values(t.peers||{}).filter(x=>x.status==='delivered').length;
 const queued=cloudStatus==='queued';
 return '<div class="flow-trace-head"><div><span class="flow-small-label">Packet ID · '+encode(chosenLabel())+'</span><div class="flow-trace-id">'+encode(t.id)+'</div></div>'+
 '<span class="flow-trace-status '+(queued?'buffering':cloudStatus==='delivered'?'ok':'')+'">'+
 (queued?'Buffered at fog':cloudStatus==='delivered'?'Cloud acknowledged':'Awaiting cloud')+'</span></div>'+
 '<div class="flow-trace-numbers">'+
 '<div><span>Received moisture</span><strong>'+t.reading.moisture+'%</strong></div>'+
 '<div><span>AI demand score</span><strong>'+(t.decision?.probability==null?'—':Math.round(t.decision.probability*100)+'%')+'</strong></div>'+
 '<div><span>Local pump</span><strong>'+ (t.pump===true?'ON':'OFF')+'</strong></div>'+
 '<div><span>Direct peer ACKs</span><strong>'+ack+' / 2</strong></div></div>'+
 '<div class="flow-receipts"><span class="flow-receipt '+(queued?'amber':'mint')+'">Cloud: '+(cloudStatus==='delivered'?'delivered':queued?'queued locally':'in flight')+'</span>'+
 Object.entries(t.peers||{}).map(([id,r])=>'<span class="flow-receipt '+(r.status==='delivered'?'mint':r.status==='unreachable'?'red':'')+'">'+encode(labels[id])+': '+encode(r.status)+'</span>').join('')+'</div>'+
 '<div class="flow-receipt-actions"><button type="button" data-flow-action="replay" class="flow-replay">'+svgIcon('reset')+' Replay packet journey</button>'+
 '<label for="flow-playback-speed">Animation speed <select id="flow-playback-speed"><option value="1" '+(playbackSpeed===1?'selected':'')+'>1×</option><option value="2" '+(playbackSpeed===2?'selected':'')+'>2×</option></select></label></div>'+
 '<div class="flow-timeline">'+(t.stages||[]).map(s=>'<div class="flow-timeline-item"><span class="flow-time-dot"></span><div><b>'+encode(phaseName(s.phase))+'</b><p>'+encode(s.detail)+'</p></div><small>'+time(s.time)+'</small></div>').join('')+'</div>'+
 (queued?'<p class="flow-queue-info">The cloud is unavailable. Data is in the fog node’s in-memory outbox and will be replayed when the cloud reconnects.</p>':'');
}
const phaseName=k=>({sensor:'Sensor packet accepted',inference:'On-device AI inference',pump:'Local irrigation command',peer:'Peer-to-peer HTTP',queue:'Offline buffer',cloud:'Cloud delivery ACK'}[k]||k);
function teachingBox(){
 return '<div class="flow-teach">'+
 '<span class="eyebrow">What to explain</span><h3>Follow one packet, not just a dashboard.</h3>'+
 '<ol><li><b>Sensors:</b> Your numbers represent readings from a field device.</li>'+
 '<li><b>Fog:</b> The chosen zone receives those values inside its own Node.js process.</li>'+
 '<li><b>AI:</b> The locally trained model decides whether to water. No cloud query is needed.</li>'+
 '<li><b>Actuator:</b> The pump changes state using that local decision.</li>'+
 '<li><b>Network:</b> The fog process pushes a summary to neighboring nodes and the cloud, storing it locally if the cloud is down.</li></ol>'+
 '<p><b>Important:</b> The animation is a replay of real process events and HTTP acknowledgments. The physical sensors and pump are simulated.</p></div>';
}
export function flowLabPage(snapshot){
 data=snapshot;
 return '<div class="page-head flow-page-head"><div><div class="eyebrow">Interactive distributed systems lab</div><h1>Watch your data travel.</h1>'+
 '<p>Enter sensor readings, follow each packet through local AI, and see exactly what changes when the cloud disconnects.</p></div>'+
 '<div class="flow-demo-status"><span class="flow-live-dot"></span> Trace-driven animation</div></div>'+
 '<div class="flow-top-grid">'+formUI()+
 '<section class="panel flow-map-panel"><div class="panelhead"><div><h2>2. Watch the packet journey</h2><p>Sensor → fog → AI → pump · peer nodes · cloud</p></div><div class="flow-top-controls">'+
 '<span id="flow-cloud-status" class="statuspill '+(!data?.cloudOnline?'alert':'')+'">'+(data?.cloudOnline?'Cloud connected':'Cloud offline')+'</span>'+
 '<button type="button" class="flow-cloud-toggle" data-flow-action="cloud-toggle">'+(data?.cloudOnline?'Disconnect cloud':'Reconnect cloud')+'</button></div></div>'+
 graph()+'</section></div>'+
 '<div class="flow-bottom-grid"><section class="panel flow-inspector-panel"><div class="panelhead"><div><h2>3. Inspect the actual transfer</h2><p>Every receipt below comes from the running services</p></div><span id="flow-tick" class="section-meta">Local tick '+(fogZone()?.tick??'—')+'</span></div>'+
 '<div id="flow-inspector" class="flow-inspector">'+selectedTraceUI()+'</div></section>'+
 '<section class="panel flow-explain-panel">'+teachingBox()+'</section></div>'+
 '<p class="flow-disclaimer">Simulation boundary: the sensor device and pump are virtual. The local model inference, HTTP peer messages, process failure and cloud acknowledgments are real. Packet movement is an explanatory replay, not a network packet capture.</p>';
}
export function initFlowLab({update,toast}){
 syncApp=update;notify=toast;
}
export function refreshFlowLab(snapshot){
 data=snapshot;
 const view=document.getElementById('flow-inspector');
 if(!view)return;
 const t=trace(),cloud=data?.cloudOnline,fo=fogZone();
 const badge=document.getElementById('flow-cloud-status');
 if(badge){badge.textContent=cloud?'Cloud connected':'Cloud offline';badge.classList.toggle('alert',!cloud);}
 const toggle=document.querySelector('[data-flow-action="cloud-toggle"]');
 if(toggle)toggle.textContent=cloud?'Disconnect cloud':'Reconnect cloud';
 const cloudNode=document.getElementById('flow-node-cloud');
 if(cloudNode)cloudNode.classList.toggle('is-offline',!cloud);
 document.getElementById('flow-path-cloud')?.classList.toggle('is-offline',!cloud);
 const fog=document.getElementById('flow-node-fog');
 if(fog)fog.classList.toggle('is-offline',fo?.offline===true);
 const count=document.getElementById('flow-tick');
 if(count)count.textContent='Local tick '+(fo?.tick??'—')+' · Buffer '+(fo?.queuedPackets??0);
 view.innerHTML=selectedTraceUI();
 if(t?.cloud?.status==='delivered' && lastCloudStatus==='queued' && !playing){
  moveOnRecovery();
 }
 lastCloudStatus=t?.cloud?.status||'';
}
async function moveOnRecovery(){
 // The actual cloud acknowledgement was observed in telemetry before we replay its route.
 await fly('flow-path-cloud','#5b9aaa',1100,playToken);
 const label=document.getElementById('flow-now');
 if(label)label.textContent='Cloud ACK received: buffered packet successfully replayed.';
}
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function stage(message,which){
 const text=document.getElementById('flow-now');
 if(text)text.textContent=message;
 for(const node of document.querySelectorAll('.flow-svg-node'))node.classList.toggle('is-active',node.id==='flow-node-'+which);
}
function fly(pathId,color,duration,token){
 return new Promise(resolve=>{
  const path=document.getElementById(pathId),container=document.getElementById('flow-packets');
  if(!path||!container){resolve();return;}
  const svg=document.getElementById('flow-map');
  if(!svg){resolve();return;}
  const circle=document.createElementNS('http://www.w3.org/2000/svg','circle');
  const glow=document.createElementNS('http://www.w3.org/2000/svg','circle');
  circle.setAttribute('r','6');circle.setAttribute('fill',color);circle.setAttribute('class','flow-packet');
  glow.setAttribute('r','13');glow.setAttribute('fill',color);glow.setAttribute('opacity','.20');
  container.append(glow,circle);
  const start=performance.now(),len=path.getTotalLength();
  function frame(now){
   if(token!==playToken||!document.getElementById('flow-map')){
    circle.remove();glow.remove();resolve();return;
   }
   const progress=Math.min(1,(now-start)/duration);
   const p=path.getPointAtLength(len*progress);
   circle.setAttribute('cx',p.x);circle.setAttribute('cy',p.y);
   glow.setAttribute('cx',p.x);glow.setAttribute('cy',p.y);
   if(progress<1)requestAnimationFrame(frame);
   else{circle.remove();glow.remove();resolve();}
  }
  requestAnimationFrame(frame);
 });
}
async function playTrace(){
 const t=trace();
 if(!t||!document.getElementById('flow-map'))return;
 const token=++playToken;
 playing=true;
 const rate=playbackSpeed;
 try{
  stage('Step 1 · Sensor readings entered the selected fog node.','sensor');
  await fly('flow-path-sensor','#6ba69a',850/rate,token);
  if(token!==playToken)return;
  stage('Step 2 · The independent fog process executed its trained ML model.','fog');
  await fly('flow-path-ai','#6eaa70',930/rate,token);
  if(token!==playToken)return;
  stage('Step 3 · Local AI '+(t.pump?'turned ON':'kept OFF')+' the simulated pump.','ai');
  await fly('flow-path-pump',t.pump?'#448ac0':'#a7b1ac',830/rate,token);
  if(token!==playToken)return;
  stage('Step 4 · Local decisions finished. Fog nodes exchange messages directly.','peer');
  if(Object.values(t.peers||{}).some(r=>r.status==='delivered'))
   await fly('flow-path-peer','#7da970',890/rate,token);
  if(token!==playToken)return;
  const latest=trace()||t;
  if(latest.cloud?.status==='delivered'){
   stage('Step 5 · Cloud received and acknowledged the telemetry summary.','cloud');
   await fly('flow-path-cloud','#64a4c6',1250/rate,token);
   if(token!==playToken)return;
   stage('Complete · Local AI, direct peers and cloud ACK are recorded.','cloud');
  }else{
   stage('Step 5 · Cloud is unavailable. Telemetry is buffered locally.','fog');
  }
 }finally{
  if(token===playToken)playing=false;
 }
}
function inputValues(){
 const formNode=document.getElementById('flow-form');
 const values={};
 for(const key of Object.keys(defaults)){
  const el=formNode?.elements?.namedItem(key);
  if(!el || el.value.trim()==='')throw Error('Enter a value for '+key);
  values[key]=Number(el.value);
  if(!Number.isFinite(values[key]))throw Error('Invalid '+key+' reading');
  const lo=key==='temperature'?-10:0,hi=key==='temperature'?60:100;
  if(values[key]<lo || values[key]>hi)throw Error(key+' must be between '+lo+' and '+hi);
 }
 return values;
}
document.addEventListener('submit',async e=>{
 if(e.target?.id!=='flow-form')return;
 e.preventDefault();
 const btn=e.target.querySelector('button[type="submit"]');
 if(btn?.disabled)return;
 try{
  const values=inputValues();
  form={...values};
  btn.disabled=true;btn.textContent='Sending to fog node…';
  const result=await post('/api/node',{id:selected,type:'inject',value:values});
  traceId=result.traceId;
  lastCloudStatus='';
  notify?.('Sensor packet '+traceId.slice(0,8)+' accepted by '+chosenLabel());
  await syncApp?.();
  playTrace();
 }catch(err){notify?.(err.message,true);}
 finally{if(btn){btn.disabled=false;btn.innerHTML=svgIcon('play')+' Send sensor packet';}}
});
document.addEventListener('change',e=>{
 if(e.target?.id==='flow-zone'){
  selected=e.target.value;traceId=null;lastCloudStatus='';
  if(data)refreshFlowLab(data);
 }
 if(e.target?.id==='flow-playback-speed')playbackSpeed=Number(e.target.value)||1;
});
document.addEventListener('click',async e=>{
 const preset=e.target.closest('[data-flow-preset]');
 if(preset){
  form={...presets[preset.dataset.flowPreset]};
  for(const [key,value] of Object.entries(form)){
   const input=document.getElementById('flow-field-'+key);
   if(input)input.value=value;
  }
  return;
 }
 const btn=e.target.closest('[data-flow-action]');
 if(!btn)return;
 const command=btn.dataset.flowAction;
 if(command==='replay'){if(playing){playToken++;playing=false;}playTrace();return;}
 if(command==='cloud-toggle'){
  const action=data?.cloudOnline?'stop':'start';
  btn.disabled=true;
  try{
   await post('/api/system',{service:'cloud',action});
   notify?.(action==='stop'?'Cloud service stopped. Fog AI and queues stay active.':'Cloud service restarting; queued readings will be replayed.');
   await syncApp?.();
  }catch(err){notify?.(err.message,true);}finally{btn.disabled=false;}
 }
});
