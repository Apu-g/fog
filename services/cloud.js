import http from 'node:http';
const latest=new Map();
const series=[];
const start=Date.now();
function send(res,code,json){res.writeHead(code,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(json));}
const server=http.createServer((req,res)=>{
  const path=new URL(req.url,'http://localhost').pathname;
  if(req.method==='GET' && path==='/health')return send(res,200,{ok:true,service:'cloud',pid:process.pid});
  if(req.method==='GET' && path==='/state'){
    const nodes=[...latest.values()];
    const fresh=nodes.filter(n=>Date.now()-n.receivedAt<6000);
    return send(res,200,{connected:true,pid:process.pid,uptime:Date.now()-start,
      lastReceived:Math.max(0,...nodes.map(n=>n.receivedAt)),
      records:series.length,activeNodes:fresh.length,storedNodes:nodes.length,
      totalLiters:Number(fresh.reduce((s,n)=>s+n.waterLiters,0).toFixed(1)),
      avgMoisture:fresh.length?Number((fresh.reduce((s,n)=>s+(n.moisture??0),0)/fresh.length).toFixed(1)):null,
      history:series.slice(-22),latest:fresh});
  }
  if(req.method==='POST' && path==='/ingest'){
    let input='';
    req.on('data',chunk=>{input+=chunk;if(input.length>16000){req.destroy();}});
    req.on('end',()=>{
      try {
        const x=JSON.parse(input);
        if(!['north','east','south'].includes(x.id)||!Number.isFinite(x.tick))return send(res,400,{error:'Invalid payload'});
        latest.set(x.id,{...x,receivedAt:Date.now()});
        series.push({id:x.id,tick:x.tick,moisture:x.moisture,pump:x.pump,traceId:x.traceId||null,time:Date.now()});
        if(series.length>600)series.splice(0,series.length-600);
        send(res,200,{ok:true});
      }catch {send(res,400,{error:'Invalid JSON'});}
    });
    return;
  }
  send(res,404,{error:'Not found'});
});
server.listen(4100,'127.0.0.1',()=>console.log('[cloud] PID '+process.pid+' · port 4100'));
process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
