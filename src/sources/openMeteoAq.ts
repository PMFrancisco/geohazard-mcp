import type {
  AirQualityData,
  Coordinates,
  SourceResult,
} from '../types/index.js';

const AQI_CATEGORIES: [number, string][] = [
  [50, 'Good'],
  [100, 'Moderate'],
  [150, 'Unhealthy for Sensitive Groups'],
  [200, 'Unhealthy'],
  [300, 'Very Unhealthy'],
  [Infinity, 'Hazardous'],
];

function aqiCategory(aqi: number): string {
  for (const [max, label] of AQI_CATEGORIES) {
    if (aqi <= max) return label;
  }
  return 'Hazardous';
}

export async function fetchOpenMeteoAq(
  coords: Coordinates,
): Promise<SourceResult<AirQualityData>> {
  const startTime = Date.now();
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 5000);

  try {
    const url =
      `https://air-quality-api.open-meteo.com/v1/air-quality` +
      `?latitude=${coords.lat}&longitude=${coords.lon}` +
      `&current=pm2_5,pm10,nitrogen_dioxide,ozone,carbon_monoxide,european_aqi`;

    const res = await fetch(url, { signal: ctrl.signal });
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
    const aqi = c.european_aqi ?? Math.round(pm25 * 2.04);

    const dominant =
      pm25 >= pm10 && pm25 >= no2 && pm25 >= o3
        ? 'pm25'
        : pm10 >= no2 && pm10 >= o3
          ? 'pm10'
          : no2 >= o3
            ? 'no2'
            : 'o3';

    const data: AirQualityData = {
      aqi,
      pm25,
      pm10,
      no2,
      o3,
      ...(co != null ? { co } : {}),
      category: aqiCategory(aqi),
      dominantPollutant: dominant,
      source: 'open-meteo-aq',
    };

    return {
      sourceId: 'open-meteo-aq',
      ok: true,
      fetchedAt: new Date(),
      data,
      latencyMs: Date.now() - startTime,
    };
  } catch (err) {
    return {
      sourceId: 'open-meteo-aq',
      ok: false,
      fetchedAt: new Date(),
      data: null,
      error: String(err),
      latencyMs: Date.now() - startTime,
    };
  } finally {
    clearTimeout(timeout);
  }
}
