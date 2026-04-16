import type {
  AirQualityData,
  Coordinates,
  SourceResult,
} from '../types/index.js';
import { fetchWithTimeout, sourceError } from './http.js';
import { computeUsAqi } from './aqi.js';

export async function fetchOpenMeteoAq(
  coords: Coordinates,
): Promise<SourceResult<AirQualityData>> {
  const startTime = Date.now();

  try {
    // Query raw µg/m³ fields only — we compute US EPA AQI ourselves so both
    // AQ sources emit the same scale (the native european_aqi uses a 0–100+
    // band system that is not comparable with OpenAQ's US-style output).
    const url =
      `https://air-quality-api.open-meteo.com/v1/air-quality` +
      `?latitude=${coords.lat}&longitude=${coords.lon}` +
      `&current=pm2_5,pm10,nitrogen_dioxide,ozone,carbon_monoxide`;

    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = (await res.json()) as {
      current: Record<string, number>;
    };
    const c = json.current;

    const pm25 = c.pm2_5 ?? 0;
    const pm10 = c.pm10 ?? 0;
    const no2 = c.nitrogen_dioxide ?? 0;
    const o3 = c.ozone ?? 0;
    const co = c.carbon_monoxide;

    const { aqi, category, dominantPollutant, whoExceedances } = computeUsAqi({
      pm25,
      pm10,
      o3,
      no2,
      ...(co != null ? { co } : {}),
    });

    const data: AirQualityData = {
      aqi,
      pm25,
      pm10,
      no2,
      o3,
      ...(co != null ? { co } : {}),
      category,
      dominantPollutant,
      source: 'open-meteo-aq',
      whoExceedances,
    };

    return {
      sourceId: 'open-meteo-aq',
      ok: true,
      fetchedAt: new Date(),
      data,
      latencyMs: Date.now() - startTime,
    };
  } catch (err) {
    return sourceError<AirQualityData>('open-meteo-aq', startTime, err);
  }
}
