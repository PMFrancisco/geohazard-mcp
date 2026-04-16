import type {
  AggregatedConditions,
  AggregatorOptions,
  AirQualityData,
  ConfigHint,
  Coordinates,
  SourceResult,
} from '../types/index.js';
import { SOURCES, type DirectSource } from '../sources/registry.js';
import {
  calculateConfidence,
  countApplicableSources,
} from '../confidence/static.js';
import { calculateRisk } from './riskScore.js';
import { detectDiscrepancies } from './compareSources.js';
import { logSourceCall } from '../logger/discrepancy.js';
import { computeUsAqi } from '../sources/aqi.js';

const SETUP_URLS: Record<string, string> = {
  OPENAQ_API_KEY: 'https://docs.openaq.org/using-the-api/api-key',
  NASA_FIRMS_KEY: 'https://firms.modaps.eosdis.nasa.gov/api/map_key/',
};

export function buildConfigHints(
  results: SourceResult<unknown>[],
  coords: Coordinates,
): ConfigHint[] {
  const applicable = countApplicableSources(coords);
  const impact =
    applicable > 0 ? Math.round((1 / applicable) * 1000) / 1000 : 0;
  const hints: ConfigHint[] = [];
  for (const r of results) {
    if (!r.reason || !r.envVar) continue;
    const url = SETUP_URLS[r.envVar];
    const message =
      r.reason === 'missing_api_key'
        ? `Set ${r.envVar} to include ${r.sourceId} data (raises confidence by up to ${impact.toFixed(2)}).` +
          (url ? ` Get a free key at ${url}` : '')
        : `${r.envVar} is set but was rejected by the ${r.sourceId} API. Verify the key is active.` +
          (url ? ` Manage keys at ${url}` : '');
    hints.push({
      sourceId: r.sourceId,
      envVar: r.envVar,
      reason: r.reason,
      message,
      confidenceImpact: impact,
    });
  }
  return hints;
}

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

  const blendedPm25 = blend(oaq.pm25, maq.pm25);
  const blendedPm10 = blend(oaq.pm10, maq.pm10);
  const blendedNo2 = blend(oaq.no2, maq.no2);
  const blendedO3 = blend(oaq.o3, maq.o3);
  const blendedCo =
    oaq.co != null || maq.co != null
      ? blend(oaq.co ?? maq.co!, maq.co ?? oaq.co!)
      : undefined;

  // Union semantics: if either source flags a pollutant exceedance, surface
  // it. A threshold signal should err toward caution — blending two sources
  // that both flag PM2.5 into a single value that doesn't flag it loses
  // information.
  const whoExceedances = [
    ...new Set([...oaq.whoExceedances, ...maq.whoExceedances]),
  ].sort();

  // Derive aqi/category/dominantPollutant from the blended pollutant values
  // so the merged AQI is consistent with the merged concentrations. (Previously
  // these fields were taken verbatim from OpenAQ, which could disagree with the
  // blended pm25/pm10/no2/o3/co numbers.)
  const {
    aqi: mergedAqi,
    category: mergedCategory,
    dominantPollutant: mergedDominant,
  } = computeUsAqi({
    pm25: blendedPm25,
    pm10: blendedPm10,
    o3: blendedO3,
    no2: blendedNo2,
    ...(blendedCo != null ? { co: blendedCo } : {}),
  });

  return {
    aqi: mergedAqi,
    pm25: blendedPm25,
    pm10: blendedPm10,
    no2: blendedNo2,
    o3: blendedO3,
    ...(blendedCo != null ? { co: blendedCo } : {}),
    category: mergedCategory,
    dominantPollutant: mergedDominant,
    source: 'openaq',
    stationDistanceKm: oaq.stationDistanceKm,
    whoExceedances,
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
  const confidence = calculateConfidence(all, coords);
  const risk = calculateRisk(conditions, airQuality);
  const configHints = buildConfigHints(all, coords);

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
    discrepancies,
    configHints,
  };
}
