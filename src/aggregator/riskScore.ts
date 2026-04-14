import type {
  AggregatedConditions,
  AirQualityData,
  FireData,
  FloodData,
  RiskAssessment,
  RiskLevel,
  SeismicData,
  SpaceWeatherData,
  VolcanicData,
  WeatherData,
} from '../types/index.js';
import type { GdacsData } from '../sources/gdacs.js';
import { SOURCES, MERGED_RISK, type RiskLayer } from '../sources/registry.js';

export function scoreWeather(w: WeatherData): number {
  let score = 0;
  if (w.precipitationMm > 50) score += 0.4;
  else if (w.precipitationMm > 20) score += 0.2;
  if (w.windKmh > 100) score += 0.4;
  else if (w.windKmh > 60) score += 0.25;
  if (w.uvIndex >= 11) score += 0.15;
  if (w.tempC > 45 || w.tempC < -30) score += 0.2;
  return Math.min(score, 1.0);
}

export function scoreCyclone(gdacs: GdacsData): number {
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

// Modified Omori decay for aftershock risk (see original for derivation).
function omoriDecay(hoursAgo: number, magnitude: number): number {
  if (hoursAgo <= 0) return 1.0;
  const days = hoursAgo / 24;
  if (magnitude >= 6.0) {
    const c = 0.5;
    const p = 0.8;
    return Math.min(1.0, Math.pow(c, p) / Math.pow(days + c, p));
  }
  return Math.pow(0.7, days);
}

export function scoreSeismic(s: SeismicData): number {
  if (s.recentEvents.length === 0) return 0;
  const now = Date.now();

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
    if (event.magnitude >= 7.0) {
      if (event.distanceKm < 100) proximity = 1.0;
      else if (event.distanceKm < 200) proximity = 0.9;
      else if (event.distanceKm < 350) proximity = 0.75;
      else if (event.distanceKm < 500) proximity = 0.55;
      else proximity = 0.35;
    } else if (event.magnitude >= 6.0) {
      if (event.distanceKm < 100) proximity = 1.0;
      else if (event.distanceKm < 200) proximity = 0.8;
      else if (event.distanceKm < 350) proximity = 0.55;
      else proximity = 0.3;
    } else {
      if (event.distanceKm < 50) proximity = 1.0;
      else if (event.distanceKm < 100) proximity = 0.85;
      else if (event.distanceKm < 200) proximity = 0.65;
      else if (event.distanceKm < 350) proximity = 0.45;
      else proximity = 0.3;
    }

    const hoursAgo = (now - new Date(event.timeUtc).getTime()) / 3600000;
    const timeFactor = omoriDecay(hoursAgo, event.magnitude);

    let score = base * proximity * timeFactor;
    if (event.tsunami) score += 0.3 * timeFactor;

    maxScore = Math.max(maxScore, score);
  }

  return Math.min(maxScore, 1.0);
}

export function scoreFire(f: FireData): number {
  let score = 0;
  if (f.totalHotspots100km > 20) score += 0.6;
  else if (f.totalHotspots100km > 5) score += 0.35;
  else if (f.totalHotspots100km > 0) score += 0.15;
  if (f.totalHotspots500km > 100) score += 0.2;
  if (f.maxBrightness !== null && f.maxBrightness > 400) score += 0.2;

  if (f.nearestDistanceKm !== null) {
    if (f.nearestDistanceKm < 10) score += 0.3;
    else if (f.nearestDistanceKm < 25) score += 0.15;
    else if (f.nearestDistanceKm < 50) score += 0.05;
  }

  return Math.min(score, 1.0);
}

export function scoreAirQuality(aq: AirQualityData): number {
  const aqi = aq.aqi;
  if (aqi <= 50) return 0;
  if (aqi <= 100) return 0.15;
  if (aqi <= 150) return 0.35;
  if (aqi <= 200) return 0.55;
  if (aqi <= 300) return 0.8;
  return 1.0;
}

export function scoreFlood(f: FloodData): number {
  if (f.dischargeM3s != null) {
    if (f.dischargeM3s > 5000) return 1.0;
    if (f.dischargeM3s > 2000) return 0.7;
    if (f.dischargeM3s > 1000) return 0.5;
    if (f.dischargeM3s > 500) return 0.3;
    if (f.dischargeM3s > 200) return 0.15;
    return 0;
  }
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

export function scoreSpaceWeather(sw: SpaceWeatherData): number {
  const kp = sw.kpIndex;
  if (kp >= 8) return 1.0;
  if (kp >= 7) return 0.8;
  if (kp >= 6) return 0.6;
  if (kp >= 5) return 0.4;
  if (kp >= 4) return 0.2;
  return 0;
}

export function scoreVolcanic(v: VolcanicData): number {
  if (v.recentActivity.length === 0) return 0;

  let maxScore = 0;
  for (const a of v.recentActivity) {
    let base: number;
    if (a.activityLevel === 'Erupting') base = 0.9;
    else if (a.activityLevel === 'Elevated') base = 0.5;
    else if (a.activityLevel === 'Warning') base = 0.25;
    else continue;

    let proximity: number;
    if (a.distanceKm < 50) proximity = 1.0;
    else if (a.distanceKm < 100) proximity = 0.8;
    else if (a.distanceKm < 200) proximity = 0.5;
    else if (a.distanceKm < 500) proximity = 0.2;
    else proximity = 0;

    maxScore = Math.max(maxScore, base * proximity);
  }

  return Math.min(maxScore, 1.0);
}

function getRiskLevel(score: number): RiskLevel {
  if (score >= 0.8) return 'critical';
  if (score >= 0.6) return 'high';
  if (score >= 0.35) return 'moderate';
  if (score >= 0.15) return 'low';
  return 'minimal';
}

type LayerAccum = { max: number; label?: string; weight: number };

export function calculateRisk(
  conditions: Partial<AggregatedConditions>,
  mergedAirQuality: AirQualityData | null,
): RiskAssessment {
  const layers = new Map<RiskLayer, LayerAccum>();

  const contribute = (
    layer: RiskLayer,
    weight: number,
    score: number,
    label?: string,
  ) => {
    const a = layers.get(layer) ?? { max: -1, label: undefined, weight };
    if (score > a.max) {
      a.max = score;
      a.label = label;
    }
    a.weight = weight;
    layers.set(layer, a);
  };

  for (const s of SOURCES) {
    if (s.kind !== 'direct' || !s.risk) continue;
    const data = conditions[s.key];
    if (data == null) continue;
    contribute(
      s.risk.layer,
      s.risk.weight,
      (s.risk.score as (d: unknown) => number)(data),
      s.risk.factorLabel,
    );
  }

  if (mergedAirQuality) {
    const hook = MERGED_RISK.airQuality;
    contribute(hook.layer, hook.weight, hook.score(mergedAirQuality));
  }

  // Weather-layer gate: preserved from the pre-refactor behavior. Weather
  // participates only if open-meteo reported data OR cyclone score > 0.
  const weatherAcc = layers.get('weather');
  if (weatherAcc) {
    const weatherPresent = conditions.weather != null;
    const cyclonePositive =
      conditions.gdacs != null && scoreCyclone(conditions.gdacs) > 0;
    if (!weatherPresent && !cyclonePositive) layers.delete('weather');
  }

  const layerScores: RiskAssessment['layerScores'] = {};
  const mainFactors: string[] = [];

  const orderedLayers: RiskLayer[] = [
    'weather',
    'seismic',
    'fire',
    'airQuality',
    'flood',
    'space',
    'volcanic',
  ];
  for (const layer of orderedLayers) {
    const acc = layers.get(layer);
    if (!acc) continue;
    const s = Math.max(0, acc.max);
    layerScores[layer] = Math.round(s * 1000) / 1000;
    if (s > 0.15) mainFactors.push(layer);
  }

  // Cyclone label: pushed iff cycloneScore > weatherBase, independent of the 0.15 threshold.
  const weatherBase = conditions.weather ? scoreWeather(conditions.weather) : 0;
  const cycloneScore = conditions.gdacs ? scoreCyclone(conditions.gdacs) : 0;
  if (cycloneScore > weatherBase) mainFactors.push('cyclone');

  let weightedSum = 0;
  let totalWeight = 0;
  for (const [, acc] of layers) {
    weightedSum += Math.max(0, acc.max) * acc.weight;
    totalWeight += acc.weight;
  }
  let overallScore = totalWeight > 0 ? weightedSum / totalWeight : 0;

  const allScores = Object.values(layerScores) as number[];
  const maxLayer = allScores.length > 0 ? Math.max(...allScores) : 0;
  if (maxLayer >= 0.9) overallScore = Math.max(overallScore, 0.7);
  else if (maxLayer >= 0.75) overallScore = Math.max(overallScore, 0.5);

  const rounded = Math.round(overallScore * 1000) / 1000;
  return {
    overallScore: rounded,
    level: getRiskLevel(rounded),
    mainFactors,
    layerScores,
  };
}
