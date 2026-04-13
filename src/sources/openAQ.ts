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

interface OpenAQLocation {
  id: number;
  name: string;
  coordinates: { latitude: number; longitude: number };
  distance: number; // metres
  sensors: Array<{
    id: number;
    parameter: { id: number; name: string; units: string };
  }>;
}

interface OpenAQLatest {
  sensorsId: number;
  value: number;
}

export async function fetchOpenAQ(
  coords: Coordinates,
): Promise<SourceResult<AirQualityData>> {
  const startTime = Date.now();
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 5000);

  const apiKey = process.env.OPENAQ_API_KEY;
  if (!apiKey) {
    clearTimeout(timeout);
    return {
      sourceId: 'openaq',
      ok: false,
      fetchedAt: new Date(),
      data: null,
      error: 'OPENAQ_API_KEY not set',
      latencyMs: Date.now() - startTime,
    };
  }

  try {
    const headers = { 'X-API-Key': apiKey };

    // Step 1: Find nearest station
    const locUrl =
      `https://api.openaq.org/v3/locations` +
      `?coordinates=${coords.lat},${coords.lon}` +
      `&radius=25000` +
      `&limit=10`;

    const locRes = await fetch(locUrl, { signal: ctrl.signal, headers });
    if (!locRes.ok) throw new Error(`Locations HTTP ${locRes.status}`);

    const locJson = (await locRes.json()) as { results: OpenAQLocation[] };
    if (!locJson.results || locJson.results.length === 0) {
      return {
        sourceId: 'openaq',
        ok: false,
        fetchedAt: new Date(),
        data: null,
        error: 'No stations within 25 km',
        latencyMs: Date.now() - startTime,
      };
    }

    // Prefer the nearest station that has PM2.5 or PM10 sensors
    const hasPm = (l: OpenAQLocation) =>
      l.sensors.some((s) => {
        const n = s.parameter.name.toLowerCase();
        return n === 'pm25' || n === 'pm2.5' || n === 'pm10';
      });

    const loc = locJson.results.find(hasPm) ?? locJson.results[0];
    const distKm = loc.distance / 1000;

    // Build sensor ID → parameter name map
    const sensorMap = new Map<number, string>();
    for (const s of loc.sensors) {
      sensorMap.set(s.id, s.parameter.name.toLowerCase());
    }

    // Step 2: Get latest measurements
    const latestUrl = `https://api.openaq.org/v3/locations/${loc.id}/latest`;
    const latestRes = await fetch(latestUrl, { signal: ctrl.signal, headers });
    if (!latestRes.ok) throw new Error(`Latest HTTP ${latestRes.status}`);

    const latestJson = (await latestRes.json()) as {
      results: OpenAQLatest[];
    };

    const vals: Record<string, number> = {};
    for (const m of latestJson.results) {
      const name = sensorMap.get(m.sensorsId);
      if (name && m.value != null) vals[name] = m.value;
    }

    const pm25 = vals['pm25'] ?? vals['pm2.5'] ?? 0;
    const pm10 = vals['pm10'] ?? 0;
    const no2 = vals['no2'] ?? 0;
    const o3 = vals['o3'] ?? 0;
    const co = vals['co'];

    // Approximate AQI from PM2.5 (simplified EPA linear)
    const aqi = Math.round(pm25 * 2.04);
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
      source: 'openaq',
      stationDistanceKm: Math.round(distKm * 10) / 10,
    };

    return {
      sourceId: 'openaq',
      ok: true,
      fetchedAt: new Date(),
      data,
      latencyMs: Date.now() - startTime,
    };
  } catch (err) {
    return {
      sourceId: 'openaq',
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
