import type {
  FireData,
  RiskAssessment,
  RiskLevel,
  SeismicData,
  WeatherData,
} from '../types/index.js';

const LAYER_WEIGHTS = {
  weather: 0.25,
  seismic: 0.25,
  fire: 0.2,
} as const;

function scoreWeather(w: WeatherData): number {
  let score = 0;
  if (w.precipitationMm > 50) score += 0.4;
  else if (w.precipitationMm > 20) score += 0.2;
  if (w.windKmh > 100) score += 0.4;
  else if (w.windKmh > 60) score += 0.25;
  if (w.uvIndex >= 11) score += 0.15;
  if (w.tempC > 45 || w.tempC < -30) score += 0.2;
  return Math.min(score, 1.0);
}

function scoreSeismic(s: SeismicData): number {
  if (s.recentEvents.length === 0) return 0;

  let maxScore = 0;
  for (const event of s.recentEvents) {
    let base: number;
    if (event.magnitude >= 7.0) base = 1.0;
    else if (event.magnitude >= 6.0) base = 0.75;
    else if (event.magnitude >= 5.0) base = 0.5;
    else if (event.magnitude >= 4.0) base = 0.25;
    else if (event.magnitude >= 3.0) base = 0.1;
    else continue;

    let proximity: number;
    if (event.distanceKm < 50) proximity = 1.0;
    else if (event.distanceKm < 100) proximity = 0.85;
    else if (event.distanceKm < 200) proximity = 0.65;
    else if (event.distanceKm < 350) proximity = 0.45;
    else proximity = 0.3;

    let score = base * proximity;
    if (event.tsunami) score += 0.3;

    maxScore = Math.max(maxScore, score);
  }

  return Math.min(maxScore, 1.0);
}

function scoreFire(f: FireData): number {
  let score = 0;
  if (f.totalHotspots100km > 20) score += 0.6;
  else if (f.totalHotspots100km > 5) score += 0.35;
  else if (f.totalHotspots100km > 0) score += 0.15;
  if (f.totalHotspots500km > 100) score += 0.2;
  if (f.maxBrightness !== null && f.maxBrightness > 400) score += 0.2;
  return Math.min(score, 1.0);
}

function getRiskLevel(score: number): RiskLevel {
  if (score >= 0.8) return 'critical';
  if (score >= 0.6) return 'high';
  if (score >= 0.35) return 'moderate';
  if (score >= 0.15) return 'low';
  return 'minimal';
}

export function calculateRisk(layers: {
  weather: WeatherData | null;
  seismic: SeismicData | null;
  fire: FireData | null;
  airQuality: null; // Phase 2
}): RiskAssessment {
  const layerScores: RiskAssessment['layerScores'] = {};
  const mainFactors: string[] = [];
  let weightedSum = 0;
  let totalWeight = 0;

  if (layers.weather) {
    const s = scoreWeather(layers.weather);
    layerScores.weather = Math.round(s * 1000) / 1000;
    weightedSum += s * LAYER_WEIGHTS.weather;
    totalWeight += LAYER_WEIGHTS.weather;
    if (s > 0.15) mainFactors.push('weather');
  }

  if (layers.seismic) {
    const s = scoreSeismic(layers.seismic);
    layerScores.seismic = Math.round(s * 1000) / 1000;
    weightedSum += s * LAYER_WEIGHTS.seismic;
    totalWeight += LAYER_WEIGHTS.seismic;
    if (s > 0.15) mainFactors.push('seismic');
  }

  if (layers.fire) {
    const s = scoreFire(layers.fire);
    layerScores.fire = Math.round(s * 1000) / 1000;
    weightedSum += s * LAYER_WEIGHTS.fire;
    totalWeight += LAYER_WEIGHTS.fire;
    if (s > 0.15) mainFactors.push('fire');
  }

  const overallScore = totalWeight > 0 ? weightedSum / totalWeight : 0;
  const rounded = Math.round(overallScore * 1000) / 1000;

  return {
    overallScore: rounded,
    level: getRiskLevel(rounded),
    mainFactors,
    layerScores,
  };
}
