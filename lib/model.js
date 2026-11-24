// Trained locally on reproducible SYNTHETIC observations. Not a crop-specific agronomy model.
function random(seed) {
  let x = seed >>> 0;
  return () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296; };
}
const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
const sigmoid = n => 1 / (1 + Math.exp(-clamp(n, -35, 35)));
function features(s) {
  return [1, (50 - s.moisture) / 16, (s.temperature - 28) / 13,
    (50 - s.humidity) / 35, s.rain / 9, s.rain >= 6 ? 1 : 0];
}
function sample(rand) {
  const moisture = rand() * 85 + 5;
  const temperature = rand() * 26 + 17;
  const humidity = rand() * 65 + 25;
  const rain = rand() < .77 ? rand() * 2.5 : rand() * 22;
  const threshold = 37 + Math.max(0, temperature - 29) * .6 + (50 - humidity) * .08 - rain * 1.2;
  const label = moisture < threshold && rain < 6 ? 1 : 0;
  return { s: { moisture, temperature, humidity, rain }, label };
}
export function trainModel(seed = 41) {
  const rand = random(seed);
  const training = Array.from({length:2400}, () => sample(rand));
  const validation = Array.from({length:500}, () => sample(rand));
  const weights = [0, 0, 0, 0, 0, 0];
  // Stochastic gradient descent; actual learned parameters, not a preset decision table.
  for (let epoch = 0; epoch < 165; epoch++) {
    const rate = .095 / (1 + epoch * .022);
    for (const item of training) {
      const xs = features(item.s);
      const estimate = sigmoid(xs.reduce((sum, v, i) => sum + v * weights[i], 0));
      const error = estimate - item.label;
      for (let i = 0; i < weights.length; i++) {
        weights[i] -= rate * (error * xs[i] + .00015 * weights[i]);
      }
    }
  }
  const correct = validation.filter(item => {
    const xs = features(item.s);
    return (sigmoid(xs.reduce((sum,v,i)=>sum+v*weights[i],0)) >= .5 ? 1 : 0) === item.label;
  }).length;
  return { weights, validationAccuracy: Number((correct / validation.length * 100).toFixed(1)),
    trainingSamples: training.length, validationSamples: validation.length, algorithm: 'Logistic regression · local SGD',
    dataset: 'Synthetic agronomic training observations', version: 'local-ml-v1' };
}
export function predictIrrigation(model, s) {
  if (s.moisture === null || ![s.moisture,s.temperature,s.humidity,s.rain].every(Number.isFinite)) {
    return { irrigate:false, probability:null, confidence:null, status:'sensor-fault',
      explanation:'Moisture sensor unavailable. Local safety rule prevents automatic watering.', evidence:['Sensor quality check failed'], source:'Local safety controller' };
  }
  const xs = features(s);
  const probability = sigmoid(xs.reduce((sum, v, i) => sum + v * model.weights[i], 0));
  const rainLock = s.rain >= 6;
  const irrigate = !rainLock && probability >= .53;
  const reasons = [];
  if (s.moisture < 36) reasons.push('Low soil moisture (' + s.moisture.toFixed(0) + '%)');
  else reasons.push('Soil moisture ' + s.moisture.toFixed(0) + '%');
  if (s.temperature >= 35) reasons.push('High temperature (' + s.temperature.toFixed(0) + '°C)');
  if (rainLock) reasons.push('Rainfall lockout (' + s.rain.toFixed(0) + ' mm/h)');
  if (!rainLock && s.rain > 1) reasons.push('Incoming rainfall lowers demand');
  return { irrigate, probability: Number(probability.toFixed(3)),
    confidence: Number((100 * Math.max(probability, 1 - probability)).toFixed(1)),
    status:rainLock ? 'rain-lockout' : irrigate ? 'irrigating' : 'monitoring',
    explanation: rainLock ? 'Rain detected; local safety controller holds irrigation off.'
      : irrigate ? 'Local AI predicts low soil moisture and starts drip irrigation.'
      : 'Local AI predicts sufficient soil moisture; pump remains off.',
    evidence: reasons, source: rainLock ? 'AI prediction + local rain safety' : 'On-device logistic regression' };
}
