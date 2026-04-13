import type {
  AggregatedConditions,
  ConfidenceLevel,
  Coordinates,
  ForecastDay,
  ForecastResponse,
  RiskLevel,
} from '../types/index.js';
import { getConditions } from './index.js';

// ── Weather models ──────────────────────────────────────────

const WEATHER_MODELS = ['gfs_global', 'ecmwf_ifs025'] as const;

interface DailyWeather {
  time: string[];
  temperature_2m_max?: number[];
  temperature_2m_min?: number[];
  temperature_2m_mean?: number[];
  precipitation_sum?: number[];
  precipitation_probability_max?: number[];
  wind_speed_10m_max?: number[];
  wind_speed_10m_mean?: number[];
  uv_index_max?: number[];
}

interface DailyAq {
  time: string[];
  pm2_5_max?: number[];
  pm10_max?: number[];
  european_aqi_max?: number[];
}

interface DailyFlood {
  time?: string[];
  river_discharge?: number[];
}

// ── Math helpers ────────────────────────────────────────────

function avg(nums: number[]): number {
  return nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = avg(values);
  return Math.sqrt(
    values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length,
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

// ── Decay constants ─────────────────────────────────────────

const DECAY = {
  fire: 0.9, // fires persist, slow decay
} as const;

/** Omori decay matching riskScore.ts — used for forecast projection */
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

// ── Per-day risk scoring (mirrors riskScore.ts) ─────────────

const LAYER_WEIGHTS = {
  weather: 0.2,
  seismic: 0.25,
  fire: 0.2,
  airQuality: 0.1,
  flood: 0.15,
  space: 0.05,
  volcanic: 0.05,
} as const;

function scoreWeatherDay(w: NonNullable<ForecastDay['weather']>): number {
  let s = 0;
  if (w.precipitationMm > 50) s += 0.4;
  else if (w.precipitationMm > 20) s += 0.2;
  if (w.windMaxKmh > 100) s += 0.4;
  else if (w.windMaxKmh > 60) s += 0.25;
  if (w.uvMax >= 11) s += 0.15;
  if (w.tempMax > 45 || w.tempMin < -30) s += 0.2;
  return Math.min(s, 1.0);
}

function scoreAqDay(aqi: number): number {
  if (aqi <= 50) return 0;
  if (aqi <= 100) return 0.15;
  if (aqi <= 150) return 0.35;
  if (aqi <= 200) return 0.55;
  if (aqi <= 300) return 0.8;
  return 1.0;
}

function scoreFloodDay(discharge: number): number {
  if (discharge > 5000) return 1.0;
  if (discharge > 2000) return 0.7;
  if (discharge > 1000) return 0.5;
  if (discharge > 500) return 0.3;
  if (discharge > 200) return 0.15;
  return 0;
}

function scoreSpaceDay(kp: number): number {
  if (kp >= 8) return 1.0;
  if (kp >= 7) return 0.8;
  if (kp >= 6) return 0.6;
  if (kp >= 5) return 0.4;
  if (kp >= 4) return 0.2;
  return 0;
}

function calculateDayRisk(day: ForecastDay): ForecastDay['risk'] {
  let weightedSum = 0;
  let totalWeight = 0;
  const factors: string[] = [];

  if (day.weather) {
    const s = scoreWeatherDay(day.weather);
    weightedSum += s * LAYER_WEIGHTS.weather;
    totalWeight += LAYER_WEIGHTS.weather;
    if (s > 0.15) factors.push('weather');
  }
  if (day.seismic && day.seismic.score > 0) {
    weightedSum += day.seismic.score * LAYER_WEIGHTS.seismic;
    totalWeight += LAYER_WEIGHTS.seismic;
    if (day.seismic.score > 0.15) factors.push('seismic');
  }
  if (day.fire && day.fire.score > 0) {
    weightedSum += day.fire.score * LAYER_WEIGHTS.fire;
    totalWeight += LAYER_WEIGHTS.fire;
    if (day.fire.score > 0.15) factors.push('fire');
  }
  if (day.airQuality) {
    const s = scoreAqDay(day.airQuality.aqi);
    weightedSum += s * LAYER_WEIGHTS.airQuality;
    totalWeight += LAYER_WEIGHTS.airQuality;
    if (s > 0.15) factors.push('airQuality');
  }
  if (day.flood) {
    const s = scoreFloodDay(day.flood.dischargeM3s);
    weightedSum += s * LAYER_WEIGHTS.flood;
    totalWeight += LAYER_WEIGHTS.flood;
    if (s > 0.15) factors.push('flood');
  }
  if (day.spaceWeather) {
    const s = scoreSpaceDay(day.spaceWeather.kpIndex);
    weightedSum += s * LAYER_WEIGHTS.space;
    totalWeight += LAYER_WEIGHTS.space;
    if (s > 0.15) factors.push('space');
  }
  if (day.volcanic && day.volcanic.score > 0) {
    weightedSum += day.volcanic.score * LAYER_WEIGHTS.volcanic;
    totalWeight += LAYER_WEIGHTS.volcanic;
    if (day.volcanic.score > 0.15) factors.push('volcanic');
  }

  let score = totalWeight > 0 ? weightedSum / totalWeight : 0;

  // Critical-override: prevent extreme single-layer events from being diluted
  const allScores: number[] = [];
  if (day.weather) allScores.push(scoreWeatherDay(day.weather));
  if (day.seismic && day.seismic.score > 0) allScores.push(day.seismic.score);
  if (day.fire && day.fire.score > 0) allScores.push(day.fire.score);
  if (day.airQuality) allScores.push(scoreAqDay(day.airQuality.aqi));
  if (day.flood) allScores.push(scoreFloodDay(day.flood.dischargeM3s));
  if (day.spaceWeather) allScores.push(scoreSpaceDay(day.spaceWeather.kpIndex));
  if (day.volcanic && day.volcanic.score > 0)
    allScores.push(day.volcanic.score);
  const maxLayer = allScores.length > 0 ? Math.max(...allScores) : 0;
  if (maxLayer >= 0.9) score = Math.max(score, 0.7);
  else if (maxLayer >= 0.75) score = Math.max(score, 0.5);

  score = round2(score);
  let level: RiskLevel = 'minimal';
  if (score >= 0.8) level = 'critical';
  else if (score >= 0.6) level = 'high';
  else if (score >= 0.35) level = 'moderate';
  else if (score >= 0.15) level = 'low';

  return { score, level, mainFactors: factors };
}

// ── Confidence degrades with forecast horizon ───────────────

function forecastConfidence(dayOffset: number): ForecastDay['confidence'] {
  const overall = round2(Math.max(0.25, 0.95 - dayOffset * 0.045));
  let level: ConfidenceLevel = 'estimate';
  if (overall >= 0.85) level = 'reliable';
  else if (overall >= 0.65) level = 'partial';
  else if (overall >= 0.4) level = 'limited';
  return { overall, level };
}

// ── Forecast-specific fetchers ──────────────────────────────

async function fetchModelWeather(
  coords: Coordinates,
  days: number,
  model: string,
): Promise<DailyWeather | null> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 8000);
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${coords.lat}&longitude=${coords.lon}` +
      `&daily=temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_speed_10m_mean,uv_index_max` +
      `&models=${model}` +
      `&forecast_days=${days}` +
      `&timezone=auto`;
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    return ((await res.json()) as { daily: DailyWeather }).daily;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchAqForecast(
  coords: Coordinates,
  days: number,
): Promise<DailyAq | null> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 5000);
  try {
    const url =
      `https://air-quality-api.open-meteo.com/v1/air-quality` +
      `?latitude=${coords.lat}&longitude=${coords.lon}` +
      `&daily=pm2_5_max,pm10_max,european_aqi_max` +
      `&forecast_days=${days}`;
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    return ((await res.json()) as { daily: DailyAq }).daily;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchFloodForecast(
  coords: Coordinates,
  days: number,
): Promise<DailyFlood | null> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 8000);
  try {
    const url =
      `https://flood-api.open-meteo.com/v1/flood` +
      `?latitude=${coords.lat}&longitude=${coords.lon}` +
      `&daily=river_discharge` +
      `&forecast_days=${Math.min(days, 30)}`;
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    return ((await res.json()) as { daily: DailyFlood }).daily;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchKpForecast(): Promise<number[] | null> {
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 5000);
  try {
    const url =
      'https://services.swpc.noaa.gov/products/noaa-planetary-k-index-forecast.json';
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const rows = (await res.json()) as string[][];
    return rows.slice(1).map((r) => parseFloat(r[1]) || 0);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function kpCategory(kp: number): string {
  if (kp < 4) return 'Quiet';
  if (kp <= 5) return 'Active';
  if (kp === 6) return 'Minor storm';
  if (kp === 7) return 'Moderate storm';
  return 'Severe storm';
}

// ── Extract day-0 scores from real-time conditions ──────────

function seismicBaseline(c: AggregatedConditions): {
  score: number;
  maxMagnitude: number;
  oldestEventHoursAgo: number;
} {
  const score = c.risk.layerScores.seismic ?? 0;
  const maxMag = c.seismic?.maxMagnitude ?? 0;
  // Find the most significant event's age (the one most likely driving the score)
  const now = Date.now();
  let oldestRelevantHours = 0;
  if (c.seismic) {
    for (const e of c.seismic.recentEvents) {
      if (e.magnitude >= maxMag - 0.5) {
        const h = (now - new Date(e.timeUtc).getTime()) / 3600000;
        oldestRelevantHours = Math.max(oldestRelevantHours, h);
      }
    }
  }
  return {
    score,
    maxMagnitude: maxMag,
    oldestEventHoursAgo: oldestRelevantHours,
  };
}

function baselineFireScore(c: AggregatedConditions): number {
  if (!c.risk.layerScores.fire) return 0;
  return c.risk.layerScores.fire;
}

function baselineVolcanicScore(c: AggregatedConditions): number {
  if (!c.volcanic) return 0;
  return c.volcanic.recentActivity.length > 0 ? 0.3 : 0;
}

// ── Main entry ──────────────────────────────────────────────

export async function getEnsembleForecast(params: {
  lat: number;
  lon: number;
  days: number;
}): Promise<ForecastResponse> {
  const coords: Coordinates = { lat: params.lat, lon: params.lon };
  const days = params.days;

  // Step 1: Get full real-time conditions (all 11 sources, logged)
  const current = await getConditions(coords);

  // Step 2: Fetch daily projections in parallel
  const [weatherModels, aqDaily, floodDaily, kpValues] = await Promise.all([
    Promise.all(WEATHER_MODELS.map((m) => fetchModelWeather(coords, days, m))),
    fetchAqForecast(coords, days),
    fetchFloodForecast(coords, days),
    fetchKpForecast(),
  ]);

  const validWeather = weatherModels.filter(
    (r): r is DailyWeather => r !== null,
  );
  const numDays = validWeather[0]?.time.length ?? days;

  // Track which sources contributed
  const sources = [...current.sourcesQueried];
  if (validWeather.length > 0)
    sources.push(...WEATHER_MODELS.map((m) => `forecast:${m}`));
  if (aqDaily) sources.push('forecast:open-meteo-aq');
  if (floodDaily) sources.push('forecast:open-meteo-flood');
  if (kpValues) sources.push('forecast:noaa-swpc');

  // Step 3: Extract baseline scores for persistent layers
  const seismic = seismicBaseline(current);
  const fireBase = baselineFireScore(current);
  const volcanicBase = baselineVolcanicScore(current);

  // Tsunami: find latest expiry
  const tsunamiActive = current.tsunami?.hasActiveWarning ?? false;
  const tsunamiExpires = current.tsunami?.activeWarnings?.[0]?.issuedAt ?? null;

  // NWS: find max severity and expiry
  const nwsCount = current.nwsAlerts?.totalAlerts ?? 0;
  const nwsMaxSeverity = current.nwsAlerts?.activeAlerts?.[0]?.severity ?? null;
  const nwsExpires =
    current.nwsAlerts?.activeAlerts
      ?.map((a) => a.expires)
      .filter(Boolean)
      .sort()
      .pop() ?? null;

  // Marine baseline
  const marineWaveHeight = current.marine?.waveHeightM ?? null;

  // Step 4: Build each day
  const forecastDays: ForecastDay[] = [];
  let prevDischarge: number | null = null;

  for (let i = 0; i < numDays; i++) {
    const date = validWeather[0]?.time[i] ?? '';
    const dayOffset = i;

    const day: ForecastDay = {
      date,
      dayOffset,
      risk: { score: 0, level: 'minimal', mainFactors: [] },
      confidence: forecastConfidence(dayOffset),
    };

    // ── Forecastable: Weather ensemble ──
    if (validWeather.length > 0) {
      const maxVals = validWeather
        .map((m) => m.temperature_2m_max?.[i])
        .filter((v): v is number => v != null);
      const minVals = validWeather
        .map((m) => m.temperature_2m_min?.[i])
        .filter((v): v is number => v != null);
      const meanVals = validWeather
        .map((m) => m.temperature_2m_mean?.[i])
        .filter((v): v is number => v != null);
      const precipVals = validWeather
        .map((m) => m.precipitation_sum?.[i])
        .filter((v): v is number => v != null);
      const probVals = validWeather
        .map((m) => m.precipitation_probability_max?.[i])
        .filter((v): v is number => v != null);
      const windMaxVals = validWeather
        .map((m) => m.wind_speed_10m_max?.[i])
        .filter((v): v is number => v != null);
      const windMeanVals = validWeather
        .map((m) => m.wind_speed_10m_mean?.[i])
        .filter((v): v is number => v != null);
      const uvVals = validWeather
        .map((m) => m.uv_index_max?.[i])
        .filter((v): v is number => v != null);

      if (meanVals.length > 0) {
        day.weather = {
          tempMin: round1(avg(minVals)),
          tempMax: round1(avg(maxVals)),
          tempMean: round1(avg(meanVals)),
          tempStddev: round2(stddev(meanVals)),
          precipitationMm: round1(avg(precipVals)),
          precipitationProbability: Math.round(avg(probVals)),
          precipitationStddev: round2(stddev(precipVals)),
          windMaxKmh: round1(avg(windMaxVals)),
          windMean: round1(avg(windMeanVals)),
          windStddev: round2(stddev(windMaxVals)),
          uvMax: round1(avg(uvVals)),
          source: i === 0 ? 'realtime' : 'forecast',
        };
      }
    }

    // ── Forecastable: Air quality ──
    if (aqDaily) {
      const pm25 = aqDaily.pm2_5_max?.[i];
      const pm10 = aqDaily.pm10_max?.[i];
      const aqi = aqDaily.european_aqi_max?.[i];
      if (pm25 != null || pm10 != null || aqi != null) {
        day.airQuality = {
          pm25: pm25 ?? 0,
          pm10: pm10 ?? 0,
          aqi: aqi ?? 0,
          source: i === 0 ? 'realtime' : 'forecast',
        };
      }
    }

    // ── Forecastable: Flood ──
    if (floodDaily?.river_discharge) {
      const discharge = floodDaily.river_discharge[i];
      if (discharge != null) {
        let trend: 'rising' | 'falling' | 'stable' = 'stable';
        if (prevDischarge !== null) {
          if (discharge > prevDischarge * 1.1) trend = 'rising';
          else if (discharge < prevDischarge * 0.9) trend = 'falling';
        }
        day.flood = {
          dischargeM3s: round1(discharge),
          trend,
          source: i === 0 ? 'realtime' : 'forecast',
        };
        prevDischarge = discharge;
      }
    }

    // ── Forecastable: Space weather (Kp forecast, ~8 entries/day) ──
    if (kpValues) {
      const startIdx = i * 8;
      const endIdx = Math.min(startIdx + 8, kpValues.length);
      if (startIdx < kpValues.length) {
        const dayKpValues = kpValues.slice(startIdx, endIdx);
        const maxKp = Math.max(...dayKpValues);
        day.spaceWeather = {
          kpIndex: round1(maxKp),
          category: kpCategory(maxKp),
          source: i === 0 ? 'realtime' : 'forecast',
        };
      }
    }

    // ── Persistent: Seismic (Omori decay from event time) ──
    if (seismic.score > 0) {
      const totalHours = seismic.oldestEventHoursAgo + dayOffset * 24;
      const decayFactor = omoriDecay(totalHours, seismic.maxMagnitude);
      // Re-apply decay relative to the day-0 decay already baked into the score
      const day0Decay = omoriDecay(
        seismic.oldestEventHoursAgo,
        seismic.maxMagnitude,
      );
      const relativeDecay = day0Decay > 0 ? decayFactor / day0Decay : 0;
      const score = round2(seismic.score * relativeDecay);
      if (score > 0.01) {
        day.seismic = {
          score,
          decayFactor: round2(relativeDecay),
          source: dayOffset === 0 ? 'realtime' : 'decayed',
        };
      }
    }

    // ── Persistent: Fire (decay ×0.9/day) ──
    if (fireBase > 0) {
      const decayFactor = Math.pow(DECAY.fire, dayOffset);
      const score = round2(fireBase * decayFactor);
      if (score > 0.01) {
        day.fire = {
          score,
          decayFactor: round2(decayFactor),
          source: dayOffset === 0 ? 'realtime' : 'decayed',
        };
      }
    }

    // ── Persistent: Volcanic (active until bulletin > 7 days) ──
    if (volcanicBase > 0 && dayOffset <= 7) {
      day.volcanic = {
        score: volcanicBase,
        source: dayOffset === 0 ? 'realtime' : 'decayed',
      };
    }

    // ── Persistent: Tsunami (until expires) ──
    if (tsunamiActive) {
      const expired =
        tsunamiExpires && new Date(tsunamiExpires).getTime() < Date.now();
      if (!expired) {
        day.tsunami = {
          active: true,
          expiresAt: tsunamiExpires,
          source: dayOffset === 0 ? 'realtime' : 'decayed',
        };
      }
    }

    // ── Persistent: NWS alerts (until expires) ──
    if (nwsCount > 0) {
      const expired = nwsExpires && new Date(nwsExpires).getTime() < Date.now();
      if (!expired) {
        day.nwsAlerts = {
          count: nwsCount,
          maxSeverity: nwsMaxSeverity,
          source: dayOffset === 0 ? 'realtime' : 'decayed',
        };
      }
    }

    // ── Persistent: Marine (slow-changing, no decay) ──
    if (marineWaveHeight !== null) {
      day.marine = {
        waveHeightM: marineWaveHeight,
        source: dayOffset === 0 ? 'realtime' : 'decayed',
      };
    }

    // ── Per-day risk ──
    day.risk = calculateDayRisk(day);

    forecastDays.push(day);
  }

  return {
    location: coords,
    current,
    days: forecastDays,
    models: validWeather.length > 0 ? [...WEATHER_MODELS] : [],
    sources: [...new Set(sources)],
    generatedAt: new Date().toISOString(),
  };
}
