import type {
  AirQualityData,
  Coordinates,
  SourceResult,
} from '../types/index.js';
import { sourceError } from './http.js';

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
    return sourceError<AirQualityData>(
      'openaq',
      startTime,
      'OPENAQ_API_KEY not set',
    );
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
      return sourceError<AirQualityData>(
        'openaq',
        startTime,
        'No stations within 25 km',
      );
    }

    // Prefer the nearest station that has PM2.5 or PM10 sensors
    const hasPm = (l: OpenAQLocation) =>
      l.sensors.some((s) => {
        const n = s.parameter.name.toLowerCase();
        return n === 'pm25' || n === 'pm2.5' || n === 'pm10';
      });

    const loc = locJson.results.find(hasPm) ?? locJson.results[0];
    const distKm = loc.distance / 1000;

    // Build sensor ID → parameter name + units map
    const sensorMap = new Map<number, { name: string; units: string }>();
    for (const s of loc.sensors) {
      sensorMap.set(s.id, {
        name: s.parameter.name.toLowerCase(),
        units: s.parameter.units.toLowerCase(),
      });
    }

    // ppm → µg/m³ conversion factors (at 25°C, 1 atm)
    const PPM_TO_UGM3: Record<string, number> = {
      o3: 1960,
      no2: 1880,
      co: 1145,
    };

    // Step 2: Get latest measurements
    const latestUrl = `https://api.openaq.org/v3/locations/${loc.id}/latest`;
    const latestRes = await fetch(latestUrl, { signal: ctrl.signal, headers });
    if (!latestRes.ok) throw new Error(`Latest HTTP ${latestRes.status}`);

    const latestJson = (await latestRes.json()) as {
      results: OpenAQLatest[];
    };

    const vals: Record<string, number> = {};
    for (const m of latestJson.results) {
      const sensor = sensorMap.get(m.sensorsId);
      if (sensor && m.value != null) {
        let value = m.value;
        // Normalise gas measurements to µg/m³
        if (sensor.units === 'ppm' && PPM_TO_UGM3[sensor.name]) {
          value *= PPM_TO_UGM3[sensor.name];
        }
        vals[sensor.name] = value;
      }
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
      stationDistanceKm: data.stationDistanceKm,
    };
  } catch (err) {
    return sourceError<AirQualityData>('openaq', startTime, err);
  } finally {
    clearTimeout(timeout);
  }
}
