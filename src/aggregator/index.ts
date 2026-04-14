import type {
  AggregatedConditions,
  AggregatorOptions,
  AirQualityData,
  Coordinates,
  SourceResult,
} from '../types/index.js';
import { SOURCES, type DirectSource } from '../sources/registry.js';
import { calculateConfidence } from '../confidence/static.js';
import { calculateRisk } from './riskScore.js';
import { detectDiscrepancies } from './compareSources.js';
import { logSourceCall } from '../logger/discrepancy.js';

/** Fetch all sources in parallel and log each call. Returns the flat result array. */
export async function fetchAllSources(
  coords: Coordinates,
  options: AggregatorOptions = {},
): Promise<{ all: SourceResult<unknown>[] }> {
  const all = (await Promise.all(
    SOURCES.map((s) => s.fetch(coords, options)),
  )) as SourceResult<unknown>[];

  for (const r of all) logSourceCall({ ...r, location: coords });

  return { all };
}

/**
 * Merge OpenAQ + Open-Meteo AQ into a single AirQualityData.
 * When both are available, blend based on OpenAQ station proximity.
 */
function mergeAirQuality(
  openaqResult: SourceResult<AirQualityData>,
  meteoAqResult: SourceResult<AirQualityData>,
): AirQualityData | null {
  const hasOpenaq = openaqResult.ok && openaqResult.data;
  const hasMeteo = meteoAqResult.ok && meteoAqResult.data;

  if (!hasOpenaq && !hasMeteo) return null;
  if (!hasOpenaq) return meteoAqResult.data;
  if (!hasMeteo) return openaqResult.data;

  const oaq = openaqResult.data!;
  const maq = meteoAqResult.data!;
  const dist = oaq.stationDistanceKm ?? Infinity;

  let oaqWeight: number;
  if (dist <= 25) oaqWeight = 0.8;
  else if (dist <= 50) oaqWeight = 0.6;
  else oaqWeight = 0.3;
  const maqWeight = 1 - oaqWeight;

  const blend = (a: number, b: number) =>
    Math.round(a * oaqWeight + b * maqWeight);

  return {
    aqi: blend(oaq.aqi, maq.aqi),
    pm25: blend(oaq.pm25, maq.pm25),
    pm10: blend(oaq.pm10, maq.pm10),
    no2: blend(oaq.no2, maq.no2),
    o3: blend(oaq.o3, maq.o3),
    ...(oaq.co != null || maq.co != null
      ? { co: blend(oaq.co ?? maq.co!, maq.co ?? oaq.co!) }
      : {}),
    category: oaq.category,
    dominantPollutant: oaq.dominantPollutant,
    source: 'openaq',
    stationDistanceKm: oaq.stationDistanceKm,
  };
}

export async function getConditions(
  coords: Coordinates,
  options: AggregatorOptions = {},
): Promise<AggregatedConditions> {
  const { all } = await fetchAllSources(coords, options);

  const conditions: Partial<AggregatedConditions> = {};
  SOURCES.forEach((s, i) => {
    if (s.kind === 'direct') {
      (s as DirectSource).apply(conditions, all[i] as SourceResult<never>);
    }
  });

  const openaqIdx = SOURCES.findIndex((s) => s.id === 'openaq');
  const meteoAqIdx = SOURCES.findIndex((s) => s.id === 'open-meteo-aq');
  const airQuality = mergeAirQuality(
    all[openaqIdx] as SourceResult<AirQualityData>,
    all[meteoAqIdx] as SourceResult<AirQualityData>,
  );
  conditions.airQuality = airQuality;

  const discrepancies = detectDiscrepancies(coords, all);
  const confidence = calculateConfidence(all, coords, discrepancies);
  const risk = calculateRisk(conditions, airQuality);

  return {
    location: coords,
    timestampUtc: new Date().toISOString(),
    sourcesQueried: all.map((r) => r.sourceId),
    sourcesFailed: all.filter((r) => !r.ok).map((r) => r.sourceId),
    weather: conditions.weather ?? null,
    seismic: conditions.seismic ?? null,
    fire: conditions.fire ?? null,
    airQuality,
    flood: conditions.flood ?? null,
    spaceWeather: conditions.spaceWeather ?? null,
    volcanic: conditions.volcanic ?? null,
    tsunami: conditions.tsunami ?? null,
    nwsAlerts: conditions.nwsAlerts ?? null,
    marine: conditions.marine ?? null,
    gdacs: conditions.gdacs ?? null,
    confidence,
    risk,
  };
}
