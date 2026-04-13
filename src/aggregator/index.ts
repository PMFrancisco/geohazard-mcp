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
import { calculateConfidence } from '../confidence/static.js';
import { calculateRisk } from './riskScore.js';
import { logSourceCall } from '../logger/discrepancy.js';

/** Fetch all 11 sources in parallel and log each call. */
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
    all,
  };
}

/**
 * Merge OpenAQ + Open-Meteo AQ into a single AirQualityData.
 * Prefer OpenAQ when a station is within 50 km; otherwise fall back to Open-Meteo AQ.
 */
function mergeAirQuality(
  openaqResult: SourceResult<AirQualityData>,
  meteoAqResult: SourceResult<AirQualityData>,
): AirQualityData | null {
  if (openaqResult.ok && openaqResult.data) {
    const dist = openaqResult.data.stationDistanceKm ?? Infinity;
    if (dist <= 50) return openaqResult.data;
  }
  if (meteoAqResult.ok && meteoAqResult.data) {
    return meteoAqResult.data;
  }
  if (openaqResult.ok && openaqResult.data) return openaqResult.data;
  return null;
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

  const confidence = calculateConfidence(all, coords);
  const risk = calculateRisk({
    weather,
    seismic,
    fire,
    airQuality,
    flood,
    spaceWeather,
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
    confidence,
    risk,
  };
}
