import test from 'node:test';
import assert from 'node:assert/strict';
import { trainModel, predictIrrigation } from '../lib/model.js';
import { makeZone, applyScenario, simulateTick } from '../lib/simulator.js';

test('local AI model trains deterministically on synthetic observations', () => {
  const a = trainModel(77);
  const b = trainModel(77);
  assert.equal(a.validationAccuracy, b.validationAccuracy);
  assert.ok(a.validationAccuracy > 0.86, 'validation accuracy should exceed 86%');
  assert.equal(a.trainingSamples, 2400);
});

test('dry, hot soils trigger irrigation without cloud connectivity', () => {
  const model = trainModel(2);
  const decision = predictIrrigation(model, { moisture: 17, temperature: 38, humidity: 25, rain: 0 });
  assert.equal(decision.irrigate, true);
  assert.ok(decision.probability > .5);
  assert.match(decision.explanation, /soil|moisture/i);
});

test('rain stops the pump even with low soil moisture', () => {
  const model = trainModel(2);
  const decision = predictIrrigation(model, { moisture: 12, temperature: 35, humidity: 30, rain: 18 });
  assert.equal(decision.irrigate, false);
  assert.match(decision.explanation, /rain/i);
});

test('sensor failure stops autonomous watering safely', () => {
  const model = trainModel(2);
  const decision = predictIrrigation(model, { moisture: null, temperature: 36, humidity: 20, rain: 0 });
  assert.equal(decision.irrigate, false);
  assert.equal(decision.status, 'sensor-fault');
});

test('drought and rain scenarios alter actual zone state', () => {
  const zone = makeZone('north');
  applyScenario(zone, 'drought');
  assert.equal(zone.scenario, 'drought');
  assert.ok(zone.moisture < 25);
  simulateTick(zone, trainModel(1));
  assert.equal(zone.pump, true);
  applyScenario(zone, 'rain');
  simulateTick(zone, trainModel(1));
  assert.equal(zone.pump, false);
});

test('zones have independent mutable state and local histories', () => {
  const a = makeZone('north');
  const b = makeZone('east');
  applyScenario(a, 'drought');
  assert.notEqual(a.moisture, b.moisture);
  assert.ok(a.events.length > 0);
  assert.equal(b.scenario, 'normal');
});

test('manual mode can override and restore AI control', () => {
  const z = makeZone('south');
  const model = trainModel(9);
  applyScenario(z,'rain');
  z.mode = 'manual';
  z.manualPump = true;
  simulateTick(z,model);
  assert.equal(z.pump,true);
  z.mode = 'auto';
  simulateTick(z,model);
  assert.equal(z.pump,false);
});
