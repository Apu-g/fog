import test from 'node:test';
import assert from 'node:assert/strict';
import {makeZone, injectReading, recordTraceStage, simulateTick, snapshot} from '../lib/simulator.js';
import {trainModel} from '../lib/model.js';

const reading={moisture:14,temperature:39,humidity:27,rain:0};

test('user readings produce a local trace without altering neighboring zones',()=>{
 const north=makeZone('north');
 const east=makeZone('east');
 const trace=injectReading(north,reading,'demo-001');
 assert.equal(trace.id,'demo-001');
 assert.deepEqual(trace.reading,reading);
 assert.equal(north.scenario,'custom');
 assert.equal(east.moisture,44);
 assert.equal(trace.stages[0].phase,'sensor');
 simulateTick(north,trainModel(11));
 recordTraceStage(trace,'inference','Local model executed');
 recordTraceStage(trace,'pump',north.pump?'Pump ON':'Pump OFF');
 assert.equal(north.pump,true);
 assert.equal(trace.stages.at(-1).phase,'pump');
 assert.equal(snapshot(north,trainModel(11)).traces[0].id,'demo-001');
});

test('invalid readings are rejected and do not mutate node state',()=>{
 const z=makeZone('south');
 for(const input of [
  {...reading,moisture:-1},
  {...reading,temperature:99},
  {...reading,humidity:101},
  {...reading,rain:301},
  {...reading,moisture:'14'},
  {...reading,temperature:NaN},
  {...reading,rain:undefined}
 ])assert.throws(()=>injectReading(z,input,'invalid'),/reading|must|range|finite|sensor/i);
 assert.equal(z.scenario,'normal');
 assert.equal(z.traces.length,0);
});

test('trace history is bounded and stores latest event order',()=>{
 const z=makeZone('east');
 for(let i=0;i<21;i++)injectReading(z,reading,'trace-'+i);
 assert.ok(z.traces.length<=12);
 assert.equal(z.traces[0].id,'trace-20');
});
