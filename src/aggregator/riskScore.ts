import type {
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

const LAYER_WEIGHTS = {
  weather: 0.2,
  seismic: 0.25,
  fire: 0.2,
  airQuality: 0.1,
  flood: 0.15,
  space: 0.05,
  volcanic: 0.05,
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

/**
 * Modified Omori decay: aftershock risk decays hyperbolically from event time.
 * For M6.0+, risk stays elevated for days 0-3, then decays.
 * For smaller events, faster decay.
 */
function omoriDecay(hoursAgo: number, magnitude: number): number {
  if (hoursAgo <= 0) return 1.0;
  const days = hoursAgo / 24;
  if (magnitude >= 6.0) {
    // Modified Omori: 1 / (days + c)^p, normalised so day 0 ≈ 1.0
    const c = 0.5; // offset to avoid singularity and keep days 0-1 high
    const p = 0.8; // slower decay than pure Omori (p=1)
    return Math.min(1.0, Math.pow(c, p) / Math.pow(days + c, p));
  }
  // Smaller events: simple exponential, half-life ~2 days
  return Math.pow(0.7, days);
}

function scoreSeismic(s: SeismicData): number {
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

function scoreFire(f: FireData): number {
  let score = 0;
  if (f.totalHotspots100km > 20) score += 0.6;
  else if (f.totalHotspots100km > 5) score += 0.35;
  else if (f.totalHotspots100km > 0) score += 0.15;
  if (f.totalHotspots500km > 100) score += 0.2;
  if (f.maxBrightness !== null && f.maxBrightness > 400) score += 0.2;

  // Proximity boost for nearest hotspot
  if (f.nearestDistanceKm !== null) {
    if (f.nearestDistanceKm < 10) score += 0.3;
    else if (f.nearestDistanceKm < 25) score += 0.15;
    else if (f.nearestDistanceKm < 50) score += 0.05;
  }

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
  if (f.dischargeM3s != null) {
    if (f.dischargeM3s > 5000) return 1.0;
    if (f.dischargeM3s > 2000) return 0.7;
    if (f.dischargeM3s > 1000) return 0.5;
    if (f.dischargeM3s > 500) return 0.3;
    if (f.dischargeM3s > 200) return 0.15;
    return 0;
  }
  // Fallback to return-period strings when discharge is unavailable
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
  if (kp >= 8) return 1.0;
  if (kp >= 7) return 0.8;
  if (kp >= 6) return 0.6;
  if (kp >= 5) return 0.4;
  if (kp >= 4) return 0.2;
  return 0;
}

function scoreVolcanic(v: VolcanicData): number {
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

export function calculateRisk(layers: {
  weather: WeatherData | null;
  seismic: SeismicData | null;
  fire: FireData | null;
  airQuality: AirQualityData | null;
  flood: FloodData | null;
  spaceWeather: SpaceWeatherData | null;
  volcanic: VolcanicData | null;
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

  if (layers.volcanic) {
    const s = scoreVolcanic(layers.volcanic);
    layerScores.volcanic = Math.round(s * 1000) / 1000;
    weightedSum += s * LAYER_WEIGHTS.volcanic;
    totalWeight += LAYER_WEIGHTS.volcanic;
    if (s > 0.15) mainFactors.push('volcanic');
  }

  let overallScore = totalWeight > 0 ? weightedSum / totalWeight : 0;

  // Critical-override: prevent extreme single-layer events from being diluted
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
