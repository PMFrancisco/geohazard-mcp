import type {
  AggregatedConditions,
  AggregatorOptions,
  AirQualityData,
  Coordinates,
  SourceResult,
} from '../types/index.js';
import { fetchOpenMeteo } from '../sources/openMeteo.js';
import { fetchUSGSEarthquake } from '../sources/usgsEarthquake.js';
import { fetchNASAFirms } from '../sources/nasaFirms.js';
import { fetchOpenAQ } from '../sources/openAQ.js';
import { fetchOpenMeteoAq } from '../sources/openMeteoAq.js';
import { fetchNoaaNws } from '../sources/noaaNws.js';
import { fetchNoaaSwpc } from '../sources/noaaSwpc.js';
import { fetchGlofas } from '../sources/glofas.js';
import { fetchSmithsonianGvp } from '../sources/smithsonianGvp.js';
import { fetchNoaaTsunami } from '../sources/noaaTsunami.js';
import { fetchCmems } from '../sources/cmems.js';
import { fetchGdacs } from '../sources/gdacs.js';
import { calculateConfidence } from '../confidence/static.js';
import { calculateRisk } from './riskScore.js';
import { detectDiscrepancies } from './compareSources.js';
import { logSourceCall } from '../logger/discrepancy.js';

/** Fetch all 12 sources in parallel and log each call. */
export async function fetchAllSources(
  coords: Coordinates,
  options: AggregatorOptions = {},
) {
  const [
    weatherResult,
    seismicResult,
    fireResult,
    openaqResult,
    meteoAqResult,
    nwsResult,
    swpcResult,
    glofasResult,
    gvpResult,
    tsunamiResult,
    cmemsResult,
    gdacsResult,
  ] = await Promise.all([
    fetchOpenMeteo(coords),
    fetchUSGSEarthquake(coords, options.radiusKm ?? 500),
    fetchNASAFirms(coords, options.firmsKey),
    fetchOpenAQ(coords),
    fetchOpenMeteoAq(coords),
    fetchNoaaNws(coords),
    fetchNoaaSwpc(coords),
    fetchGlofas(coords),
    fetchSmithsonianGvp(coords),
    fetchNoaaTsunami(coords),
    fetchCmems(coords),
    fetchGdacs(coords),
  ]);

  const all: SourceResult<unknown>[] = [
    weatherResult,
    seismicResult,
    fireResult,
    openaqResult,
    meteoAqResult,
    nwsResult,
    swpcResult,
    glofasResult,
    gvpResult,
    tsunamiResult,
    cmemsResult,
    gdacsResult,
  ];

  for (const r of all) {
    logSourceCall({ ...r, location: coords });
  }

  return {
    weatherResult,
    seismicResult,
    fireResult,
    openaqResult,
    meteoAqResult,
    nwsResult,
    swpcResult,
    glofasResult,
    gvpResult,
    tsunamiResult,
    cmemsResult,
    gdacsResult,
    all,
  };
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

  // Both available — blend based on station distance
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
  const {
    weatherResult,
    seismicResult,
    fireResult,
    openaqResult,
    meteoAqResult,
    nwsResult,
    swpcResult,
    glofasResult,
    gvpResult,
    tsunamiResult,
    cmemsResult,
    gdacsResult,
    all,
  } = await fetchAllSources(coords, options);

  const weather = weatherResult.ok ? weatherResult.data : null;
  const seismic = seismicResult.ok ? seismicResult.data : null;
  const fire = fireResult.ok ? fireResult.data : null;
  const airQuality = mergeAirQuality(openaqResult, meteoAqResult);
  const flood = glofasResult.ok ? glofasResult.data : null;
  const spaceWeather = swpcResult.ok ? swpcResult.data : null;
  const volcanic = gvpResult.ok ? gvpResult.data : null;
  const tsunami = tsunamiResult.ok ? tsunamiResult.data : null;
  const nwsAlerts = nwsResult.ok ? nwsResult.data : null;
  const marine = cmemsResult.ok ? cmemsResult.data : null;
  const gdacs = gdacsResult.ok ? gdacsResult.data : null;

  const discrepancies = detectDiscrepancies(coords, all);
  const confidence = calculateConfidence(all, coords, discrepancies);
  const risk = calculateRisk({
    weather,
    seismic,
    fire,
    airQuality,
    flood,
    spaceWeather,
    volcanic,
    gdacs,
  });

  return {
    location: coords,
    timestampUtc: new Date().toISOString(),
    sourcesQueried: all.map((r) => r.sourceId),
    sourcesFailed: all.filter((r) => !r.ok).map((r) => r.sourceId),
    weather,
    seismic,
    fire,
    airQuality,
    flood,
    spaceWeather,
    volcanic,
    tsunami,
    nwsAlerts,
    marine,
    gdacs,
    confidence,
    risk,
  };
}
