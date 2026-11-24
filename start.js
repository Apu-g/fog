// Single-command supervisor: UI stays alive when the cloud or a fog process goes down.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import net from 'node:net';
const root=path.dirname(fileURLToPath(import.meta.url));
const services={
 cloud:['services/cloud.js'],
 north:['services/fog-node.js','north','4201'],
 east:['services/fog-node.js','east','4202'],
 south:['services/fog-node.js','south','4203'],
 hub:['services/hub.js']
};
const live=new Map();
const desired=new Map(Object.keys(services).map(id=>[id,true]));
let quitting=false;
function spawnService(id){
 if(live.has(id))return;
 const child=spawn(process.execPath,services[id],{cwd:root,stdio:['ignore','pipe','pipe','ipc'],env:process.env});
 live.set(id,child);
 child.stdout.on('data',b=>process.stdout.write(String(b)));
 child.stderr.on('data',b=>process.stderr.write('['+id+'] '+String(b)));
 child.on('exit',(code,signal)=>{
   if(live.get(id)===child)live.delete(id);
   if(quitting)return;
   console.log('[supervisor] '+id+' exited ('+(signal||code)+')');
   if(desired.get(id))setTimeout(()=>{if(!quitting&&desired.get(id)&&!live.has(id))spawnService(id);},1100);
 });
 if(id==='hub')child.on('message',m=>{if(m.type==='system-control')control(m,child);});
}
function terminate(id) {
 const child=live.get(id); if(!child)return;
 live.delete(id);
 child.kill('SIGTERM');
 const kill=setTimeout(()=>{if(child.exitCode===null)child.kill('SIGKILL');},1300);kill.unref();
}
function start(id){desired.set(id,true);spawnService(id);}
function stop(id){desired.set(id,false);terminate(id);}
function control(message,hub) {
 const {id,action,service}=message;
 try{
   if(action==='reset'&&service==='all'){
     for(const name of ['cloud','north','east','south'])stop(name);
     setTimeout(()=>{if(!quitting)for(const name of ['cloud','north','east','south'])start(name);},400);
   }else if(service!=='hub'&&services[service]){
     if(action==='stop')stop(service);
     else if(action==='start')start(service);
     else throw Error('Invalid system action');
   }else throw Error('Unknown service');
   hub.send({type:'system-result',id,ok:true,action,service});
 }catch(e){hub.send({type:'system-result',id,ok:false,error:e.message});}
}
// Fail early with an actionable error instead of endlessly respawning on occupied ports.
async function portAvailable(port){return await new Promise(resolve=>{
 const check=net.createServer();check.once('error',()=>resolve(false));
 check.listen(port,'127.0.0.1',()=>check.close(()=>resolve(true)));
});}
const required=[Number(process.env.DASH_PORT||3000),4100,4201,4202,4203];
const available=await Promise.all(required.map(portAvailable));
const occupied=required.filter((p,i)=>!available[i]);
if(occupied.length){console.error('[agrofog] Ports already in use: '+occupied.join(', ')+'. Stop the previous demo or other services, then retry.');process.exit(1);}
for(const id of Object.keys(services))spawnService(id);
console.log('');
console.log('  AGROFOG AI  ·  distributed farming demo');
console.log('  Open: http://localhost:'+(process.env.DASH_PORT||3000));
console.log('  No npm install, API keys, internet, or physical sensors required.');
console.log('  Press Ctrl+C to stop all services.\n');
function shutdown() {
 if(quitting)return;quitting=true;
 for(const id of live.keys())terminate(id);
 setTimeout(()=>process.exit(0),350).unref();
}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
