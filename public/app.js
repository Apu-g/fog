import {flowLabPage, refreshFlowLab, initFlowLab} from './flow-lab.js';
const app=document.getElementById('app');
const toastEl=document.getElementById('toast');
const state={data:null,page:'overview',selected:'north',speed:1,busy:false,demoStep:-1,presentation:false,lastError:''};
const names={north:'North Field',east:'East Orchard',south:'South Greenhouse'};
const scenarios=[
 {id:'normal',label:'Normal',icon:'check'},
 {id:'drought',label:'Drought',icon:'sun'},
 {id:'heatwave',label:'Heatwave',icon:'thermo'},
 {id:'rain',label:'Heavy rain',icon:'droplet'},
 {id:'sensor-fault',label:'Sensor fault',icon:'alert'}
];
const demoSteps=[
 {title:'Establish the normal baseline',description:'All three field sensors send live readings to their own fog node. The cloud receives summaries, while the AI decides locally.',note:'Three separately running processes perform the farm-zone decisions.',action:'baseline'},
 {title:'Induce drought in North Field',description:'A sudden loss of soil moisture forces the North Field local AI to turn on drip irrigation.',note:'Watch moisture increase and the pump change to ON. This is an inference inside Fog Node 01.',action:'drought'},
 {title:'Disconnect the cloud',description:'Physically stop the separate cloud service. The dashboard continues to query fog nodes directly.',note:'The cloud becomes unavailable, but the field sensors and AI decisions keep running.',action:'cloud-off'},
 {title:'Make it rain while offline',description:'Apply heavy rainfall at North Field while the cloud remains disconnected. Its local safety controller should stop irrigation.',note:'Cloud access is not required for this pump decision.',action:'rain'},
 {title:'Reconnect the cloud',description:'Restart the cloud service and observe field telemetry begin flowing to the aggregator again.',note:'New telemetry resumes in the cloud after recovery.',action:'cloud-on'},
 {title:'Demonstrate sensor fault safety',description:'Disconnect the East Orchard moisture sensor. Its local decision engine fails safe, leaving the automatic pump OFF.',note:'Faults are visible in the local node rather than hidden by a global dashboard.',action:'fault'},
 {title:'Restore the farm',description:'Restart the independent cloud and all three fog services, clearing the simulated disturbances.',note:'The live demo is ready for another presentation.',action:'reset'}
];
const icon=(name,cls='')=>'<svg class="'+cls+'" aria-hidden="true"><use href="#'+name+'"></use></svg>';
const esc=x=>String(x??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const fmt=n=>typeof n==='number'?n.toFixed(1):'—';
const clock=time=>time?new Date(time).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'}):'—';
const zone=id=>(state.data?.nodes||[]).find(n=>n.id===id);
const online=n=>n && !n.offline;
const shortMode=n=>!online(n)?'Offline':n.decision?.status==='sensor-fault'?'Sensor alert':n.pump?'Irrigating':n.decision?.status==='rain-lockout'?'Rain lockout':'Monitoring';
const statusClass=n=>!online(n)?'dead':n.decision?.status==='sensor-fault'?'warning':n.pump?'watering':n.scenario==='drought'||n.scenario==='heatwave'?'warning':'';
let toastTimer;
function toast(message,error=false){
 clearTimeout(toastTimer);
 toastEl.textContent=message;
 toastEl.className='toast show'+(error?' error':'');
 toastTimer=setTimeout(()=>toastEl.className='toast',3700);
}
async function api(path,payload){
 const response=await fetch(path,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)});
 const data=await response.json();
 if(!response.ok)throw Error(data.error||'Action failed');
 return data;
}
async function action(path,payload,message){
 if(state.busy)return;
 state.busy=true;
 try{await api(path,payload);if(message)toast(message);await update();}catch(e){toast(e.message,true);}finally{state.busy=false;render();}
}
function header(){
 const cloud=state.data.cloudOnline;
 return '<header class="topbar"><div class="breadcrumb">Smart agriculture <span aria-hidden="true">/</span> <b>'+({overview:'Farm overview',flow:'Data flow lab',network:'Fog network',ai:'AI decisions',guide:'Demo guide'}[state.page])+'</b></div>'+
 '<div class="top-actions"><span class="clock">'+clock(state.data.time)+'</span><label class="speed-control">Speed <select id="speed" aria-label="Simulation speed">'+[1,2,4].map(x=>'<option value="'+x+'" '+(state.speed===x?'selected':'')+'>'+x+'×</option>').join('')+'</select></label>'+ 
 '<span class="livepill '+(cloud?'':'alert')+'"><span class="dot '+(cloud?'':'off')+'"></span>'+(cloud?'Network live':'Cloud disconnected')+'</span>'+
 '<button class="softbtn" data-action="presentation" title="Toggle presentation mode">'+icon('grid')+' Presentation</button>'+
 '<button class="softbtn" data-action="reset" title="Reset entire simulation">'+icon('reset')+' Reset</button></div></header>';
}
function sidebar(){
 return '<aside class="sidebar"><div class="brand"><span class="brandmark">'+icon('leaf')+'</span><div><strong>agrofog<span style="display:inline;color:#a7d28b">.</span></strong><span>Farm intelligence</span></div></div>'+
 '<div class="navtitle">Control room</div><nav class="nav" aria-label="Main navigation">'+[
 ['overview','grid','Overview'],['flow','arrows','Data flow lab'],['network','network','Fog network'],['ai','brain','AI decisions'],['guide','play','Live demo guide']
 ].map(p=>'<button data-page="'+p[0]+'" class="'+(state.page===p[0]?'active':'')+'">'+icon(p[1])+' '+p[2]+'</button>').join('')+'</nav>'+
 '<div class="sidebar-bottom"><div class="sidebar-box"><span class="mini-tag"><span class="mini-dot"></span> DEMONSTRATION MODE</span><h4>Ready for the classroom</h4><p>Run real failure scenarios and explain how AI works without an internet connection.</p><button data-page="guide">Start guided walkthrough '+icon('arrow')+'</button></div>'+
 '<div class="sidebar-foot">3 independent fog nodes<br>Local AI · Synthetic sensor data<br>100% offline-capable simulation</div></div></aside>';
}
function metric(title,value,unit,detail,ic){
 return '<div class="metric"><div class="metric-top"><span>'+title+'</span>'+icon(ic)+'</div><div class="metric-value">'+value+(unit?'<small> '+unit+'</small>':'')+'</div><div class="metric-detail">'+detail+'</div></div>';
}
function metrics(){
 const nodes=state.data.nodes;const active=nodes.filter(online);
 const avg=active.filter(n=>typeof n.moisture==='number');
 const avgMoisture=avg.length?(avg.reduce((s,n)=>s+n.moisture,0)/avg.length).toFixed(0):'—';
 const pumps=active.filter(n=>n.pump).length;
 const saved=active.reduce((s,n)=>s+Math.max(0,n.baselineLiters-n.waterLiters),0);
 return '<section class="metrics" aria-label="Live farm indicators">'+
 metric('Fog nodes connected',active.length+' / 3','','Independent field controllers','network')+
 metric('Average soil moisture',avgMoisture,avg.length?'%':'','Across responding sensors','droplet')+
 metric('Active irrigation pumps',pumps+' / 3','','Locally controlled, not by cloud','bolt')+
 metric('Water not used',saved.toFixed(0),'L','Estimated vs fixed schedule','leaf')+'</section>';
}
function field(n){
 const isOn=online(n),selected=state.selected===n.id;
 const plot=n.id==='east'?'orchard':n.id==='south'?'greenhouse':'';
 const pct=isOn&&typeof n.moisture==='number'?Math.max(0,Math.min(100,n.moisture)):0;
 return '<button aria-pressed="'+selected+'" aria-label="Inspect '+esc(n.label)+'" data-select="'+n.id+'" class="field '+(selected?'selected ':'')+(!isOn?'offline':'')+'">'+
 '<div class="fieldhead"><span class="fieldcode">'+esc(n.sensor||'NODE')+'</span><span class="statusflag '+statusClass(n)+'">'+shortMode(n)+'</span></div>'+
 '<div class="crop-plot '+plot+'" aria-hidden="true">'+Array.from({length:15},()=>'<span class="seed"></span>').join('')+'</div>'+
 '<h3>'+esc(n.label)+'</h3><p>'+esc(n.crop||'Field node')+' · '+esc(n.area||'')+'</p>'+
 '<div class="field-bottom"><div class="soilread"><span>Soil moisture</span><strong>'+(isOn&&n.moisture!==null?fmt(n.moisture)+'%':'—')+'</strong></div>'+
 '<div class="progress-track"><div class="progress-fill '+(pct<35?'low':'')+'" style="width:'+pct+'%"></div></div></div></button>';
}
function farmPanel(){
 return '<section class="panel"><div class="panelhead"><div><h2>Your living farm</h2><p>Select a field to inspect its independent fog node</p></div><span class="section-meta">'+icon('wifi')+' Local IoT mesh</span></div>'+
 '<div class="farm-canvas"><div class="farm-fields">'+state.data.nodes.map(field).join('')+'</div></div>'+
 '<div class="farm-footer"><span class="legend"><i></i> Healthy soil &nbsp; <i class="blue"></i> Irrigation active</span><span>LIVE SENSOR SIMULATION</span></div></section>';
}
function detailPanel(){
 const n=zone(state.selected);
 if(!online(n))return '<section class="panel"><div class="panelhead"><div><h2>'+esc(names[state.selected])+'</h2><p>Fog node unavailable</p></div></div><div class="detail-content"><div class="decision warning"><span class="decision-icon">'+icon('alert')+'</span><div><b>Node disconnected</b><p>Its service is stopped. Other fog nodes keep operating. Restart this node below.</p></div></div><div class="detail-foot"><span>Independent process offline</span><button data-action="restart-node" data-id="'+state.selected+'">Restart node</button></div></div></section>';
 const faulty=n.moisture===null;const percent=faulty?0:Math.max(0,Math.min(100,n.moisture));
 const dec=n.decision||{status:'monitoring',explanation:'Model warming up',evidence:[]};
 const stateClass=faulty?'warning':n.pump?'working':'';
 const title=faulty?'Sensor validation failed':n.pump?'Irrigation running':dec.status==='rain-lockout'?'Rainfall protection active':'AI monitoring conditions';
 return '<section class="panel"><div class="panelhead"><div><h2>Field intelligence</h2><p>Local AI · live device telemetry</p></div><span class="section-meta"><span class="mini-dot"></span> Node online</span></div>'+
 '<div class="detail-content"><div class="detail-title"><div><span class="id">FOG '+({north:'01',east:'02',south:'03'}[n.id])+'</span><h3 style="margin:9px 0 0;font-size:18px">'+esc(n.label)+'</h3></div><span class="mode">'+(n.mode==='auto'?'Autonomous mode':'Manual control')+'</span></div>'+
 '<div class="water-row"><div class="gauge" style="--percent:'+percent+'%"><div class="gauge-inner"><strong>'+(faulty?'—':n.moisture.toFixed(0)+'%')+'</strong><small>Soil moisture</small></div></div>'+
 '<div class="water-copy"><h3>'+(faulty?'Sensor unavailable':percent>=45?'Healthy soil':percent>=30?'Moderate moisture':'Water stress detected')+'</h3><p>Directly measured by '+esc(n.sensor)+'.<br>AI model evaluates each reading locally.</p></div></div>'+
 '<div class="sensor-grid"><div class="sensor">'+icon('thermo')+'<small>Temperature</small><b>'+fmt(n.temperature)+'°</b></div>'+
 '<div class="sensor">'+icon('droplet')+'<small>Humidity</small><b>'+fmt(n.humidity)+'%</b></div>'+
 '<div class="sensor">'+icon('cloud')+'<small>Rainfall</small><b>'+fmt(n.rain)+'<span style="font-size:10px"> mm/h</span></b></div></div>'+
 '<div class="decision '+stateClass+'"><span class="decision-icon">'+icon(faulty?'alert':n.pump?'droplet':'brain')+'</span><div><b>'+title+'</b><p>'+esc(dec.explanation)+(n.mode==='manual'?' Manual override controls the pump.':'')+'</p></div></div>'+
 '<div class="detail-foot"><span>Model accuracy '+(n.model?.validationAccuracy??'—')+'% · synthetic validation</span><button data-page="ai">Inspect AI model '+icon('arrow')+'</button></div>'+
 '<div class="toggle-row"><span class="reading-label">Pump control: '+(n.mode==='auto'?'Local AI':'Manual override')+'</span>'+
 '<button data-action="mode" data-value="'+(n.mode==='auto'?'manual':'auto')+'">'+(n.mode==='auto'?'Switch to manual':'Restore AI autonomy')+'</button></div>'+
 (n.mode==='manual'?'<div class="toggle-row"><span class="reading-label">Pump currently '+(n.pump?'ON':'OFF')+'</span><button class="'+(n.pump?'on':'')+'" data-action="pump" data-value="'+(n.pump?'false':'true')+'">'+(n.pump?'Turn pump OFF':'Turn pump ON')+'</button></div>':'')+
 '</div></section>';
}
function scenarioPanel(){
 const n=zone(state.selected);
 return '<section class="panel"><div class="panelhead"><div><h2>Change real-world conditions</h2><p>Inject a scenario into '+esc(names[state.selected])+'</p></div><span class="section-meta">INTERACTIVE LAB</span></div>'+
 '<div class="scenario-body"><p class="scenario-desc">Choose a scenario. The selected field changes sensor readings; its own AI makes the pump decision.</p>'+
 '<div class="scenario-grid">'+scenarios.map(s=>'<button '+(!online(n)?'disabled':'')+' aria-pressed="'+(n?.scenario===s.id)+'" class="scenario-btn '+(n?.scenario===s.id?'active':'')+'" data-scenario="'+s.id+'">'+icon(s.icon)+esc(s.label)+'</button>').join('')+'</div>'+
 '<div class="inline-alert">'+icon('info')+' Try Drought, then disconnect the cloud from Fog network. The field still waters itself.</div></div></section>';
}
function recentEvents(){
 const events=state.data.nodes.flatMap(n=>(n.events||[]).map(e=>({...e,field:n.label}))).sort((a,b)=>b.time-a.time).slice(0,7);
 return '<section class="panel"><div class="panelhead"><div><h2>Recent decisions</h2><p>Recorded by the local field controllers</p></div><span class="section-meta">LIVE LOG</span></div><div class="feed">'+
 (events.length?events.map(e=>'<div class="event"><span class="event-mark '+esc(e.type)+'">'+icon(e.type==='decision'?'bolt':e.type==='scenario'?'sun':'clock')+'</span><div><b>'+esc(e.message)+'</b><small>'+esc(e.field)+' · '+clock(e.time)+'</small></div></div>').join(''):'<div class="empty">No events yet. Try a scenario to generate one.</div>')+'</div></section>';
}
function overview(){
 return '<div class="hero"><div><div class="eyebrow">Intelligence at the edge of the field</div><h1>Grow smarter. Decide locally.</h1>'+
 '<p>Three connected farming zones. Three independent AI brains. One live control room. Watch how fog computing protects a farm—even when the cloud is gone.</p><button class="primarybtn" style="margin-top:17px" data-page="flow">'+icon('arrows')+' Open interactive data flow lab</button></div>'+ 
 '<div class="hero-card"><span class="round-icon">'+icon('shield')+'</span><div><b>Offline-first intelligence</b><small>Decisions happen on the fog nodes</small></div></div></div>'+
 (!state.data.cloudOnline?'<div class="offline-message"><div><strong>Cloud service is disconnected</strong><p>Your three local fog controllers remain accessible and autonomous.</p></div><button data-action="cloud-on">Reconnect cloud</button></div>':'')+
 metrics()+'<div class="two-col">'+farmPanel()+detailPanel()+'</div>'+
 '<div class="below">'+scenarioPanel()+recentEvents()+'</div>'+
 '<div class="footnote"><span>'+icon('info')+' All crops, sensors, soil readings and water estimates are simulated for learning.</span><span>Local processing keeps running without internet access.</span></div>';
}
function chart(n){
 const history=(n?.history||[]).slice(-32);
 const valid=history.filter(x=>typeof x.moisture==='number');
 if(valid.length<2)return '<div class="empty">Waiting for a few sensor samples to draw a trend.</div>';
 const left=38,right=490,top=18,bottom=135;
 const coords=valid.map(h=>{
  const index=history.findIndex(t=>t.tick===h.tick);
  const x=left+index/(Math.max(1,history.length-1))*(right-left);
  const y=bottom-(h.moisture/100)*(bottom-top);
  return x.toFixed(1)+','+y.toFixed(1);
 });
 const last=coords[coords.length-1].split(',');
 return '<svg viewBox="0 0 520 165" role="img" aria-label="Soil moisture trend for '+esc(n.label)+'">'+
 [20,40,60,80].map(v=>'<line x1="38" x2="490" y1="'+(bottom-v/100*(bottom-top))+'" y2="'+(bottom-v/100*(bottom-top))+'" stroke="#e4ece2" stroke-dasharray="3 5"/><text x="5" y="'+(bottom-v/100*(bottom-top)+3)+'" font-size="10" fill="#9aae9a">'+v+'%</text>').join('')+
 '<polyline points="'+coords.join(' ')+'" fill="none" stroke="#629c69" stroke-width="3.1" stroke-linecap="round" stroke-linejoin="round"/>'+
 '<circle cx="'+last[0]+'" cy="'+last[1]+'" r="4.5" fill="#629c69" stroke="#fff" stroke-width="2"/>'+
 '<text x="38" y="156" font-size="10" fill="#9aae9a">Earlier readings</text><text x="490" y="156" font-size="10" fill="#9aae9a" text-anchor="end">Latest reading</text></svg>';
}
function network(){
 const d=state.data,cloud=d.cloudOnline;
 const topo=d.nodes.map(n=>'<div class="topology-node '+(!online(n)?'offline':'')+'"><span class="node-icon">'+icon('brain')+'</span>'+
 '<b>Fog node '+({north:'01',east:'02',south:'03'}[n.id])+'</b><small>'+esc(n.label)+'</small><small>PID '+(n.pid||'—')+' · Port '+({north:4201,east:4202,south:4203}[n.id])+'</small><small>Peer links: '+(n.peers?.length||0)+' · AI ticks: '+(n.tick||0)+'</small>'+ 
 '<small>Buffered packets: '+(n.queuedPackets||0)+'</small><span class="node-state">'+(online(n)?'● Local AI operational':'● Service offline')+'</span></div>').join('');
 return '<div class="page-head"><div><div class="eyebrow">Distributed architecture</div><h1>Fog network</h1><p>These are separate running processes, not three tiles backed by one algorithm. Cloud can fail independently without disrupting local decisions.</p></div>'+
 '<button class="primarybtn" data-action="'+(cloud?'cloud-off':'cloud-on')+'">'+icon(cloud?'x':'reset')+(cloud?' Disconnect cloud':' Reconnect cloud')+'</button></div>'+
 '<div class="network-layout"><section class="panel"><div class="panelhead"><div><h2>Live network topology</h2><p>Observe the separation of local fog and central cloud</p></div><span class="statuspill '+(cloud?'':'alert')+'"><span class="dot '+(cloud?'':'off')+'"></span>'+(cloud?'Cloud connected':'Cloud offline')+'</span></div>'+
 '<div class="network-diagram"><div class="topology-cloud '+(cloud?'':'offline')+'">'+icon('cloud')+'<div><b>Central cloud aggregator</b><span>'+(cloud?'Port 4100 · '+(d.cloud?.records||0)+' records received':'Stopped · No telemetry upload')+'</span></div></div>'+
 '<div class="connection-branch '+(cloud?'':'offline')+'"></div><div class="topology-nodes">'+topo+'</div>'+
 '<div class="peerline">'+icon('arrows')+' Nodes exchange neighboring conditions directly, without the cloud</div></div></section>'+
 '<section class="panel"><div class="panelhead"><div><h2>What runs where?</h2><p>Show this to explain fog computing</p></div></div>'+
 '<div class="explain-list"><div class="explain-item"><b>1 · IoT sensor layer</b><p>Virtual soil, humidity, rainfall and temperature sensors generate readings inside each zone process.</p></div>'+
 '<div class="explain-item"><b>2 · Fog / local AI layer</b><p>Each node runs a trained logistic regression model, local safety rules, pump actuation and peer-to-peer messaging.</p></div>'+
 '<div class="explain-item"><b>3 · Store and forward</b><p>Fog nodes buffer outgoing data in local memory while the cloud is down, then replay queued telemetry automatically after reconnecting.</p></div>'+
 '<div class="explain-item"><b>4 · Cloud analytics layer</b><p>The separate cloud process receives summarized readings and aggregates historical activity. It never controls the local pumps.</p></div>'+
 '<div class="explain-item"><b>5 · Independent demo observer</b><p>The control room can inspect fog nodes even while the cloud process is intentionally stopped.</p></div></div></section></div>'+
 '<section class="panel full-row"><div class="panelhead"><div><h2>Service health & fault injection</h2><p>Stop or restore an independent service in real time</p></div></div>'+
 '<div class="table-wrap"><table class="node-table"><thead><tr><th>Service</th><th>Address</th><th>Local model</th><th>Cloud uplink</th><th>Status / action</th></tr></thead><tbody>'+
 d.nodes.map(n=>'<tr><td><strong>'+esc(n.label)+'</strong></td><td>127.0.0.1:'+({north:4201,east:4202,south:4203}[n.id])+'</td><td>'+(online(n)?n.model?.validationAccuracy+'% accuracy':'—')+'</td><td>'+(online(n)?(n.cloudSync?'Connected':'Offline'):'—')+'</td><td><button data-action="'+(online(n)?'stop-node':'restart-node')+'" data-id="'+n.id+'">'+(online(n)?'Disconnect node':'Restart node')+'</button></td></tr>').join('')+
 '<tr><td><strong>Cloud aggregator</strong></td><td>127.0.0.1:4100</td><td>Not required</td><td>'+ (cloud?'Receiving':'Offline')+'</td><td><button data-action="'+(cloud?'cloud-off':'cloud-on')+'">'+(cloud?'Disconnect':'Reconnect')+'</button></td></tr>'+
 '</tbody></table></div></section><p class="subtitle">Note: all services run on your laptop for the demo. Each service has a separate OS process and TCP port; a Raspberry Pi can replace a virtual node later.</p>';
}
function ai(){
 const d=state.data;
 return '<div class="page-head"><div><div class="eyebrow">Explainable machine learning</div><h1>AI decisions, made on site.</h1><p>Every fog node learns a logistic regression classifier from deterministic synthetic examples at startup, predicts irrigation risk, and applies local safety constraints.</p></div><span class="statuspill">'+icon('shield')+' No remote API needed</span></div>'+
 '<div class="ai-layout">'+d.nodes.map(n=>{
  if(!online(n))return '<section class="panel ai-node"><h3>'+esc(n.label)+'</h3><p>Model process offline. Restart from Fog network.</p><button class="outlinebtn" data-action="restart-node" data-id="'+n.id+'">Restart node</button></section>';
  const p=n.decision?.probability;
  return '<section class="panel ai-node"><header><span class="node-icon">'+icon('brain')+'</span><div><b>'+esc(n.label)+'</b><small>Own model · Port '+n.port+'</small></div></header>'+
  '<div class="eyebrow">Predicted irrigation need</div><div class="ai-score">'+(p===null||p===undefined?'—':(p*100).toFixed(0))+'<small>% probability</small></div>'+
  '<p>'+esc(n.decision?.explanation||'Reading sensor data')+'</p><div class="ai-evidence"><b style="font-size:11px">Factors considered</b>'+
  (n.decision?.evidence||[]).map(e=>'<p>'+icon('check')+esc(e)+'</p>').join('')+'</div>'+
  '<div class="ai-footer"><span>'+n.model.validationAccuracy+'% validation accuracy</span><span>'+n.model.trainingSamples+' training rows</span></div></section>';
 }).join('')+'</div>'+
 '<div class="two-col full-row"><section class="panel"><div class="panelhead"><div><h2>Soil moisture over time</h2><p>Actual simulated sensor readings · '+esc(names[state.selected])+'</p></div><select aria-label="Select field for trend" class="inline-select" id="chart-zone">'+Object.keys(names).map(id=>'<option value="'+id+'" '+(id===state.selected?'selected':'')+'>'+esc(names[id])+'</option>').join('')+'</select></div>'+
 '<div class="chart">'+chart(zone(state.selected))+'</div></section>'+
 '<section class="panel"><div class="panelhead"><div><h2>About the AI model</h2><p>What is real here, and what is simulated?</p></div></div><div class="explain-list">'+
 '<div class="explain-item"><b>Actual local training and inference</b><p>Each process trains logistic regression with stochastic gradient descent over 2,400 synthetic examples and validates on 500 unseen synthetic examples.</p></div>'+
 '<div class="explain-item"><b>Four sensor features</b><p>Soil moisture, air temperature, relative humidity and rain rate are scored to estimate watering need.</p></div>'+
 '<div class="explain-item"><b>Safety policy</b><p>Heavy rain or missing sensor values force safe automatic decisions; manual override is clearly marked.</p></div>'+
 '<div class="explain-item"><b>Educational scope</b><p>The model is trained on generated observations, not field studies. Never use this simulator to control production irrigation.</p></div>'+
 '</div></section></div>';
}
function guide(){
 const next=state.demoStep+1<demoSteps.length?state.demoStep+1:0;
 const upcoming=demoSteps[next];
 const last=state.demoStep>=0?demoSteps[state.demoStep]:null;
 return '<div class="page-head"><div><div class="eyebrow">Classroom presentation</div><h1>One walkthrough. Every concept.</h1><p>Click through the six core fog-computing behaviors and reset. Each step triggers a real change in the running services.</p></div></div>'+
 '<div class="guide-layout"><section class="panel demo-hero"><span>LIVE DEMONSTRATION · STEP '+(next+1)+' OF '+demoSteps.length+'</span><h2>'+esc(upcoming.title)+'</h2><p>'+esc(upcoming.description)+'</p>'+
 '<button class="primarybtn" data-action="demo-next" '+(state.busy?'disabled':'')+'>'+icon('play')+(state.demoStep===demoSteps.length-1?' Restart walkthrough':' Execute this step')+'</button><button class="softbtn" style="margin:12px 0 0 9px;background:#e3f3d5;color:#245039" data-page="flow">'+icon('arrows')+' Open data flow lab</button>'+ 
 (last?'<div class="demo-result"><strong>Last step executed: '+esc(last.title)+'</strong><p>'+esc(last.note)+'</p></div>':'')+'</section>'+
 '<section class="panel"><div class="panelhead"><div><h2>Demonstration sequence</h2><p>Explain each part as the system responds</p></div></div><div class="steps">'+
 demoSteps.map((s,i)=>'<div class="step '+(i===next?'current':i<next?'done':'')+'"><span class="stepnum">'+(i<next?icon('check'):i+1)+'</span><div><b>'+esc(s.title)+'</b><p>'+esc(s.note)+'</p></div></div>').join('')+'</div></section></div>'+
 '<section class="panel full-row" style="padding:22px 25px"><div class="eyebrow" style="margin-bottom:13px">What to tell your evaluator</div><div class="sim-note"><b>Fog computing is the architecture, not a cloud dashboard theme.</b> Here the trained models and pump controllers run in three independent processes, communicate directly with their neighbors, and send summaries to another cloud process. Stopping the cloud leaves the local pumps functional. Values are simulated, but the distributed processing and fault injection are real.</div></section>';
}
function render(){
 if(!state.data)return;
 app.innerHTML='<div class="shell">'+sidebar()+'<main class="main">'+header()+'<div class="content">'+
 ({overview,flow:()=>flowLabPage(state.data),network,ai,guide}[state.page]||overview)()+'</div></main></div>';
 document.body.classList.toggle('presentation',state.presentation);
}
async function update(){
 try{
  const resp=await fetch('/api/state',{cache:'no-store'});
  if(!resp.ok)throw Error('Could not reach demo server');
  state.data=await resp.json();
  state.lastError='';
  if(state.page==='flow' && document.getElementById('flow-inspector')){
    refreshFlowLab(state.data);
  }else render();
 }catch(e){
  if(!state.data)app.innerHTML='<div class="loading"><span class="loading-leaf">✳</span><strong>Waiting for the AgroFog services</strong><p>'+esc(e.message)+'</p><button class="primarybtn" style="margin:18px auto" onclick="location.reload()">Retry connection</button></div>';
  if(state.lastError!==e.message){state.lastError=e.message;toast(e.message,true);}
 }
}
async function guidedAction(){
 if(state.busy)return;
 const next=state.demoStep+1<demoSteps.length?state.demoStep+1:0;
 const step=demoSteps[next];
 state.busy=true;
 try{
  if(step.action==='baseline'){await api('/api/system',{action:'reset',service:'all'});state.selected='north';state.speed=1;}
  if(step.action==='drought'){await api('/api/node',{id:'north',type:'scenario',value:'drought'});state.selected='north';}
  if(step.action==='cloud-off')await api('/api/system',{action:'stop',service:'cloud'});
  if(step.action==='rain'){await api('/api/node',{id:'north',type:'scenario',value:'rain'});state.selected='north';}
  if(step.action==='cloud-on')await api('/api/system',{action:'start',service:'cloud'});
  if(step.action==='fault'){await api('/api/node',{id:'east',type:'scenario',value:'sensor-fault'});state.selected='east';}
  if(step.action==='reset'){await api('/api/system',{action:'reset',service:'all'});state.selected='north';state.speed=1;}
  state.demoStep=next;
  toast('Executed: '+step.title);
 }catch(e){toast('Step could not execute: '+e.message,true);}
 finally{state.busy=false;await update();}
}
document.addEventListener('click',async e=>{
 const tab=e.target.closest('[data-page]');
 if(tab){state.page=tab.dataset.page;render();window.scrollTo({top:0,behavior:'smooth'});return;}
 const tile=e.target.closest('[data-select]');
 if(tile){state.selected=tile.dataset.select;render();return;}
 const scenario=e.target.closest('[data-scenario]');
 if(scenario){await action('/api/node',{id:state.selected,type:'scenario',value:scenario.dataset.scenario},'Applied '+scenario.dataset.scenario+' to '+names[state.selected]);return;}
 const button=e.target.closest('[data-action]');
 if(!button)return;
 const a=button.dataset.action,id=button.dataset.id;
 if(a==='presentation'){state.presentation=!state.presentation;render();return;}
 if(a==='demo-next'){await guidedAction();return;}
 if(a==='reset'){await action('/api/system',{action:'reset',service:'all'},'Restarted the entire simulation');state.demoStep=-1;state.speed=1;render();return;}
 if(a==='cloud-off'){await action('/api/system',{action:'stop',service:'cloud'},'Cloud service stopped. Fog AI remains operational.');return;}
 if(a==='cloud-on'){await action('/api/system',{action:'start',service:'cloud'},'Cloud service restarting. Local nodes will reconnect.');return;}
 if(a==='stop-node'){await action('/api/system',{action:'stop',service:id},names[id]+' fog service stopped');return;}
 if(a==='restart-node'){await action('/api/system',{action:'start',service:id},names[id]+' fog service restarting');return;}
 if(a==='mode'){await action('/api/node',{id:state.selected,type:'mode',value:button.dataset.value},'Updated pump control mode');return;}
 if(a==='pump'){await action('/api/node',{id:state.selected,type:'pump',value:button.dataset.value==='true'},'Changed local manual pump setting');return;}
});
document.addEventListener('change',e=>{
 if(e.target.id==='chart-zone'){state.selected=e.target.value;render();}
 if(e.target.id==='speed'){state.speed=Number(e.target.value);action('/api/speed',{speed:state.speed},'Simulation running at '+state.speed+'×');}
});
async function poll(){
 await update();
 setTimeout(poll,1050);
}
initFlowLab({update,toast});
poll();
