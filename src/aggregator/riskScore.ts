import type {
  AirQualityData,
  FireData,
  FloodData,
  RiskAssessment,
  RiskLevel,
  SeismicData,
  SpaceWeatherData,
  WeatherData,
} from '../types/index.js';
import type { GdacsData } from '../sources/gdacs.js';

const LAYER_WEIGHTS = {
  weather: 0.25,
  seismic: 0.25,
  fire: 0.2,
  airQuality: 0.15,
  flood: 0.1,
  space: 0.05,
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

function scoreCyclone(gdacs: GdacsData): number {
  const cyclones = gdacs.events.filter((e) => e.eventType === 'TC');
  if (cyclones.length === 0) return 0;

  let max = 0;
  for (const c of cyclones) {
    if (c.alertLevel === 'Red') max = Math.max(max, 1.0);
    else if (c.alertLevel === 'Orange') max = Math.max(max, 0.6);
    else max = Math.max(max, 0.15);
  }
  return max;
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

function scoreAirQuality(aq: AirQualityData): number {
  const aqi = aq.aqi;
  if (aqi <= 50) return 0;
  if (aqi <= 100) return 0.15;
  if (aqi <= 150) return 0.35;
  if (aqi <= 200) return 0.55;
  if (aqi <= 300) return 0.8;
  return 1.0;
}

function scoreFlood(f: FloodData): number {
  switch (f.returnPeriod) {
    case '> 100y':
      return 1.0;
    case '> 20y':
      return 0.6;
    case '> 5y':
      return 0.3;
    default:
      return 0;
  }
}

function scoreSpaceWeather(sw: SpaceWeatherData): number {
  const kp = sw.kpIndex;
  if (kp >= 7) return 1.0;
  if (kp >= 6) return 0.6;
  if (kp >= 4) return 0.3;
  return 0;
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
  airQuality: AirQualityData | null;
  flood: FloodData | null;
  spaceWeather: SpaceWeatherData | null;
  gdacs: GdacsData | null;
}): RiskAssessment {
  const layerScores: RiskAssessment['layerScores'] = {};
  const mainFactors: string[] = [];
  let weightedSum = 0;
  let totalWeight = 0;

  // Weather layer — boosted by GDACS cyclone data
  const weatherBase = layers.weather ? scoreWeather(layers.weather) : 0;
  const cycloneBoost = layers.gdacs ? scoreCyclone(layers.gdacs) : 0;
  const hasWeatherData = layers.weather || cycloneBoost > 0;

  if (hasWeatherData) {
    const s = Math.max(weatherBase, cycloneBoost);
    layerScores.weather = Math.round(s * 1000) / 1000;
    weightedSum += s * LAYER_WEIGHTS.weather;
    totalWeight += LAYER_WEIGHTS.weather;
    if (s > 0.15) mainFactors.push('weather');
    if (cycloneBoost > weatherBase) mainFactors.push('cyclone');
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

  if (layers.airQuality) {
    const s = scoreAirQuality(layers.airQuality);
    layerScores.airQuality = Math.round(s * 1000) / 1000;
    weightedSum += s * LAYER_WEIGHTS.airQuality;
    totalWeight += LAYER_WEIGHTS.airQuality;
    if (s > 0.15) mainFactors.push('airQuality');
  }

  if (layers.flood) {
    const s = scoreFlood(layers.flood);
    layerScores.flood = Math.round(s * 1000) / 1000;
    weightedSum += s * LAYER_WEIGHTS.flood;
    totalWeight += LAYER_WEIGHTS.flood;
    if (s > 0.15) mainFactors.push('flood');
  }

  if (layers.spaceWeather) {
    const s = scoreSpaceWeather(layers.spaceWeather);
    layerScores.space = Math.round(s * 1000) / 1000;
    weightedSum += s * LAYER_WEIGHTS.space;
    totalWeight += LAYER_WEIGHTS.space;
    if (s > 0.15) mainFactors.push('space');
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
