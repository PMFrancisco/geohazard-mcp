import type {
  AggregatedConditions,
  AggregatorOptions,
  Coordinates,
} from '../types/index.js';
import { fetchOpenMeteo } from '../sources/openMeteo.js';
import { fetchUSGSEarthquake } from '../sources/usgsEarthquake.js';
import { fetchNASAFirms } from '../sources/nasaFirms.js';
import { calculateConfidence } from '../confidence/static.js';
import { calculateRisk } from './riskScore.js';
import { logSourceCall } from '../logger/discrepancy.js';

export async function getConditions(
  coords: Coordinates,
  options: AggregatorOptions = {},
): Promise<AggregatedConditions> {
  const [weatherResult, seismicResult, fireResult] = await Promise.all([
    fetchOpenMeteo(coords),
    fetchUSGSEarthquake(coords, options.radiusKm ?? 500),
    fetchNASAFirms(coords, options.firmsKey),
  ]);

  for (const r of [weatherResult, seismicResult, fireResult]) {
    logSourceCall({ ...r, location: coords });
  }

  const weather = weatherResult.ok ? weatherResult.data : null;
  const seismic = seismicResult.ok ? seismicResult.data : null;
  const fire = fireResult.ok ? fireResult.data : null;

  const all = [weatherResult, seismicResult, fireResult];
  const confidence = calculateConfidence(all, coords);
  const risk = calculateRisk({ weather, seismic, fire, airQuality: null });

  return {
    location: coords,
    timestampUtc: new Date().toISOString(),
    sourcesQueried: all.map((r) => r.sourceId),
    sourcesFailed: all.filter((r) => !r.ok).map((r) => r.sourceId),
    weather,
    seismic,
    fire,
    airQuality: null,
    confidence,
    risk,
  };
}
