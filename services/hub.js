import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir=fileURLToPath(new URL('../public/',import.meta.url));
const port=Number(process.env.DASH_PORT||3000);
const fogPorts={north:4201,east:4202,south:4203};
const pending=new Map();
let requestCounter=1;
const MIME={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
function respond(res,code,data){res.writeHead(code,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(data));}
async function readBody(req) {
  let text='';
  for await(const chunk of req){text+=chunk;if(text.length>12000)throw Error('Payload too large');}
  try{return JSON.parse(text||'{}');}catch{throw Error('Invalid JSON');}
}
async function retrieve(port,path,method='GET',data){
  const res=await fetch('http://127.0.0.1:'+port+path,{method,
    headers:data?{'content-type':'application/json'}:undefined,
    body:data?JSON.stringify(data):undefined,signal:AbortSignal.timeout(700)});
  const json=await res.json();
  if(!res.ok)throw Error(json.error||'Request failed');
  return json;
}
function launcher(action,service) {
  return new Promise((resolve,reject)=>{
    const id=requestCounter++;
    const timeout=setTimeout(()=>{pending.delete(id);reject(Error('Launcher did not respond'));},3000);
    pending.set(id,(response)=>{clearTimeout(timeout);response.ok?resolve(response):reject(Error(response.error||'Launcher failed'));});
    if(!process.send){clearTimeout(timeout);pending.delete(id);return reject(Error('Launch with start.js'));}
    process.send({type:'system-control',id,action,service});
  });
}
process.on('message',(message)=>{if(message.type==='system-result' && pending.has(message.id)){pending.get(message.id)(message);pending.delete(message.id);}});
async function handle(req,res){
  const url=new URL(req.url,'http://localhost');
  if(req.method==='GET' && url.pathname==='/api/state'){
    const settled=await Promise.allSettled([retrieve(4201,'/state'),retrieve(4202,'/state'),retrieve(4203,'/state'),retrieve(4100,'/state')]);
    const nodes=settled.slice(0,3).map((r,i)=>r.status==='fulfilled'?r.value:{
      id:Object.keys(fogPorts)[i],label:['North Field','East Orchard','South Greenhouse'][i],
      offline:true,events:[],history:[]});
    const cloud=settled[3].status==='fulfilled'?settled[3].value:null;
    return respond(res,200,{time:Date.now(),nodes,cloud,cloudOnline:!!cloud,simulation:true,project:'AgroFog AI',
      localNodesOnline:nodes.filter(n=>!n.offline).length});
  }
  if(req.method==='GET' && url.pathname==='/api/health')return respond(res,200,{ok:true,service:'demo-hub'});
  if(req.method==='POST' && url.pathname.startsWith('/api/')){
    try{
      const input=await readBody(req);
      if(url.pathname==='/api/node'){
        const p=fogPorts[input.id];
        if(!p) return respond(res,400,{error:'Unknown fog node'});
        if(!['scenario','mode','pump','reset','inject'].includes(input.type)) return respond(res,400,{error:'Invalid action'});
        if(input.type==='inject'){
          const v=input.value;
          const limits={moisture:[0,100],temperature:[-10,60],humidity:[0,100],rain:[0,100]};
          if(!v||typeof v!=='object'||Array.isArray(v)||Object.entries(limits).some(([key,[min,max]])=>
            typeof v[key]!=='number'||!Number.isFinite(v[key])||v[key]<min||v[key]>max))
            return respond(res,400,{error:'Invalid sensor readings. Enter numeric values in the permitted ranges.'});
        }
        const r=await retrieve(p,'/control','POST',{type:input.type,value:input.value});
        return respond(res,200,r);
      }
      if(url.pathname==='/api/speed'){
        if(![1,2,4].includes(input.speed))return respond(res,400,{error:'Invalid speed'});
        const results=await Promise.allSettled(Object.values(fogPorts).map(p=>retrieve(p,'/control','POST',{type:'speed',value:input.speed})));
        return respond(res,200,{ok:true,updated:results.filter(r=>r.status==='fulfilled').length});
      }
      if(url.pathname==='/api/system'){
        if(!['cloud','north','east','south','all'].includes(input.service)||!['stop','start','reset'].includes(input.action))return respond(res,400,{error:'Invalid system command'});
        const result=await launcher(input.action,input.service);
        return respond(res,200,result);
      }
      return respond(res,404,{error:'No such API'});
    } catch(e){return respond(res,502,{error:e.message});}
  }
  if(req.method!=='GET')return respond(res,405,{error:'Method not allowed'});
  const pathname=url.pathname==='/'?'/index.html':url.pathname;
  const allowed=['/index.html','/app.js','/flow-lab.js','/style.css','/flow-lab.css','/favicon.svg'];
  if(!allowed.includes(pathname))return respond(res,404,{error:'Not found'});
  const file=path.join(dir,pathname);
  try{
    const bytes=await fs.readFile(file);
    res.writeHead(200,{'content-type':MIME[path.extname(file)]||'application/octet-stream','cache-control':'no-cache',
      'x-content-type-options':'nosniff'});
    res.end(bytes);
  }catch{respond(res,404,{error:'Asset missing'});}
}
const server=http.createServer((req,res)=>{handle(req,res).catch(e=>respond(res,500,{error:e.message}));});
server.listen(port,'127.0.0.1',()=>console.log('[dashboard] http://localhost:'+port+' · PID '+process.pid));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
