import { predictIrrigation } from './model.js';
const data = {
  north:{id:'north',label:'North Field',crop:'Tomatoes',area:'1.2 ha',sensor:'SEN-01',port:4201,moisture:54,temperature:29,humidity:56,soil:'Loamy',accent:'#9FCB60'},
  east:{id:'east',label:'East Orchard',crop:'Citrus',area:'0.9 ha',sensor:'SEN-02',port:4202,moisture:44,temperature:31,humidity:50,soil:'Sandy',accent:'#E7B46D'},
  south:{id:'south',label:'South Greenhouse',crop:'Leafy greens',area:'0.6 ha',sensor:'SEN-03',port:4203,moisture:65,temperature:27,humidity:68,soil:'Peaty',accent:'#70BC9B'}
};
export const ZONES = data;
const round = n => Number(n.toFixed(1));
export function addEvent(zone, type, message) {
  zone.events.unshift({ id:zone.id + '-' + (zone.eventCounter++), time:Date.now(), tick:zone.tick, type, message, zone:zone.id });
  zone.events = zone.events.slice(0,40);
}
export function makeZone(id) {
  const preset = data[id];
  if (!preset) throw new Error('Unknown zone ' + id);
  const zone = {...preset, scenario:'normal', mode:'auto', manualPump:false, pump:false,
    rain:0, tick:0, modelDecision:null, history:[], events:[], eventCounter:1,
    waterLiters:0, baselineLiters:0, peerReadings:{}, traces:[], speed:1, lastTick:Date.now(), bornAt:Date.now()};
  addEvent(zone,'system','Fog node booted; autonomous AI controller ready');
  return zone;
}
export function applyScenario(zone, scenario) {
  if (!['normal','drought','heatwave','rain','sensor-fault'].includes(scenario)) throw new Error('Invalid scenario');
  zone.scenario = scenario;
  const preset = data[zone.id];
  if (scenario === 'normal') {
    zone.moisture = preset.moisture; zone.temperature = preset.temperature;
    zone.humidity = preset.humidity; zone.rain = 0;
  } else if (scenario === 'drought') {
    zone.moisture = 17; zone.temperature = 37; zone.humidity = 24; zone.rain = 0;
  } else if (scenario === 'heatwave') {
    zone.moisture = 27; zone.temperature = 44; zone.humidity = 18; zone.rain = 0;
  } else if (scenario === 'rain') {
    zone.moisture = 56; zone.temperature = 23; zone.humidity = 91; zone.rain = 18;
  } else if (scenario === 'sensor-fault') {
    zone.moisture = null; zone.rain = 0; zone.temperature = 33; zone.humidity = 44;
  }
  zone.mode = 'auto'; zone.manualPump = false;
  addEvent(zone,'scenario',scenario === 'normal' ? 'Conditions returned to normal' : 'Demo scenario activated: ' + scenario);
}
// Trace stages are tied to actual local inference, HTTP responses, and cloud acknowledgements.
export function recordTraceStage(trace, phase, detail) {
  trace.stages.push({phase,detail,time:Date.now()});
  trace.updatedAt=Date.now();
  if(trace.stages.length>32)trace.stages.splice(0,trace.stages.length-32);
}
export function injectReading(zone, reading, traceId) {
  if(!reading || typeof reading!=='object' || Array.isArray(reading)) throw new Error('Sensor reading must be an object');
  for(const [key,min,max] of [['moisture',0,100],['temperature',-10,60],['humidity',0,100],['rain',0,100]]){
    if(typeof reading[key]!=='number'||!Number.isFinite(reading[key])||reading[key]<min||reading[key]>max)
      throw new Error('Sensor reading '+key+' must be a finite number in range '+min+'–'+max);
  }
  if(typeof traceId!=='string'||!traceId||traceId.length>80)throw new Error('Invalid trace ID');
  const clean={moisture:reading.moisture,temperature:reading.temperature,humidity:reading.humidity,rain:reading.rain};
  Object.assign(zone,clean,{scenario:'custom',mode:'auto',manualPump:false});
  const trace={id:traceId,nodeId:zone.id,createdAt:Date.now(),updatedAt:Date.now(),
    reading:clean,stages:[],decision:null,pump:null,
    cloud:{status:'pending',time:null},peers:{}};
  recordTraceStage(trace,'sensor','Simulated sensor data accepted: '+clean.moisture+'% moisture · '+clean.temperature+'°C');
  zone.traces.unshift(trace);
  if(zone.traces.length>12)zone.traces.length=12;
  addEvent(zone,'telemetry','Manual sensor packet '+traceId.slice(0,8)+' accepted');
  return trace;
}
export function simulateTick(zone, model) {
  zone.tick += 1;
  zone.lastTick = Date.now();
  zone.baselineLiters += 4.2; // Compared with a fixed schedule: educational illustration only.
  const drift = Math.sin(zone.tick * .24 + zone.port) * .14;
  if (zone.scenario === 'normal') {
    zone.temperature = round(zone.temperature + drift * .13);
    zone.humidity = round(Math.min(92,Math.max(12,zone.humidity - drift * .15)));
  }
  const previousPump = zone.pump;
  zone.modelDecision = predictIrrigation(model, zone);
  zone.pump = zone.mode === 'manual' ? zone.manualPump : zone.modelDecision.irrigate;
  if (zone.moisture !== null) {
    const loss = zone.scenario === 'drought' ? 1.3 : zone.scenario === 'heatwave' ? 1.1 : .3;
    const rainGain = zone.rain >= 6 ? 2.7 : 0;
    zone.moisture = round(Math.min(95,Math.max(5,zone.moisture + (zone.pump ? 5.3 : 0) + rainGain - loss)));
  }
  if (zone.pump) zone.waterLiters = round(zone.waterLiters + 7.5);
  if (previousPump !== zone.pump) addEvent(zone,'decision',zone.mode==='manual' ? (zone.pump ? 'Operator activated pump manually' : 'Operator stopped pump manually') : (zone.pump ? 'Local AI activated drip irrigation' : 'Local AI stopped drip irrigation'));
  if (zone.tick % 11 === 0 && zone.scenario === 'normal') addEvent(zone,'telemetry','Local sensor sample validated');
  zone.history.push({ tick:zone.tick, time:Date.now(), moisture:zone.moisture, temperature:zone.temperature, pump:zone.pump, risk:zone.modelDecision.probability });
  zone.history = zone.history.slice(-42);
  return zone;
}
export function snapshot(zone, model, connected = false) {
  return { id:zone.id,label:zone.label,crop:zone.crop,area:zone.area,soil:zone.soil,
    sensor:zone.sensor,port:zone.port,scenario:zone.scenario,mode:zone.mode,
    moisture:zone.moisture,temperature:zone.temperature,humidity:zone.humidity,rain:zone.rain,
    pump:zone.pump,waterLiters:zone.waterLiters,baselineLiters:zone.baselineLiters, tick:zone.tick,
    history:zone.history,events:zone.events,traces:zone.traces,decision:zone.modelDecision,model:{
      algorithm:model.algorithm, trainingSamples:model.trainingSamples,
      validationAccuracy:model.validationAccuracy, version:model.version, dataset:model.dataset
    }, peers:Object.values(zone.peerReadings).filter(p=>Date.now()-p.time < 8000),
    cloudSync:connected,lastTick:zone.lastTick,uptime:Date.now()-zone.bornAt,speed:zone.speed };
}
