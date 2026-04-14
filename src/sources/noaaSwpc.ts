import type {
  Coordinates,
  SourceResult,
  SpaceWeatherData,
} from '../types/index.js';
import { fetchWithTimeout, sourceError } from './http.js';

function kpCategory(kp: number): string {
  if (kp < 4) return 'Quiet';
  if (kp <= 5) return 'Active';
  if (kp === 6) return 'Minor storm';
  if (kp === 7) return 'Moderate storm';
  if (kp === 8) return 'Strong storm';
  return 'Severe storm';
}

export async function fetchNoaaSwpc(
  _coords: Coordinates,
): Promise<SourceResult<SpaceWeatherData>> {
  const startTime = Date.now();

  try {
    // Planetary K-index (last 24h entries)
    const kpUrl =
      'https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json';
    const res = await fetchWithTimeout(kpUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    // Response is array of arrays: [time_tag, Kp, Kp_fraction, a_running, station_count]
    // First row is header
    const rows = (await res.json()) as string[][];
    const dataRows = rows.slice(1);

    if (dataRows.length === 0) throw new Error('No Kp data available');

    const latest = dataRows[dataRows.length - 1];
    const kp = parseFloat(latest[1]);

    // Try solar wind speed
    let solarWindSpeed: number | null = null;
    try {
      const windRes = await fetchWithTimeout(
        'https://services.swpc.noaa.gov/products/summary/solar-wind-speed.json',
        { timeoutMs: 3000 },
      );
      if (windRes.ok) {
        const windJson = (await windRes.json()) as { WindSpeed: string };
        solarWindSpeed = parseFloat(windJson.WindSpeed) || null;
      }
    } catch {
      // solar wind is supplementary, ok to skip
    }

    const data: SpaceWeatherData = {
      kpIndex: kp,
      kpCategory: kpCategory(kp),
      solarWindSpeedKms: solarWindSpeed,
      geomagneticStorm: kp >= 5,
      auroraAlert: kp >= 4,
    };

    return {
      sourceId: 'noaa-swpc',
      ok: true,
      fetchedAt: new Date(),
      data,
      latencyMs: Date.now() - startTime,
    };
  } catch (err) {
    return sourceError<SpaceWeatherData>('noaa-swpc', startTime, err);
  }
}
