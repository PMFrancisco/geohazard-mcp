import type { Coordinates, SourceResult, WeatherData } from '../types/index.js';
import { fetchWithTimeout, sourceError } from './http.js';

const WMO_CODES: Record<number, string> = {
  0: 'Clear sky',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Depositing rime fog',
  51: 'Light drizzle',
  53: 'Moderate drizzle',
  55: 'Dense drizzle',
  61: 'Slight rain',
  63: 'Moderate rain',
  65: 'Heavy rain',
  71: 'Slight snow',
  73: 'Moderate snow',
  75: 'Heavy snow',
  77: 'Snow grains',
  80: 'Slight rain showers',
  81: 'Moderate rain showers',
  82: 'Violent rain showers',
  85: 'Slight snow showers',
  86: 'Heavy snow showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm with slight hail',
  99: 'Thunderstorm with heavy hail',
};

export async function fetchOpenMeteo(
  coords: Coordinates,
): Promise<SourceResult<WeatherData>> {
  const startTime = Date.now();

  try {
    const url =
      `https://api.open-meteo.com/v1/forecast` +
      `?latitude=${coords.lat}&longitude=${coords.lon}` +
      `&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,precipitation,uv_index,weather_code` +
      `&timezone=auto`;

    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = (await res.json()) as {
      current: Record<string, number>;
    };
    const c = json.current;

    const data: WeatherData = {
      tempC: c.temperature_2m,
      feelsLikeC: c.apparent_temperature,
      humidityPct: c.relative_humidity_2m,
      windKmh: c.wind_speed_10m,
      precipitationMm: c.precipitation,
      condition: WMO_CODES[c.weather_code as number] ?? `WMO ${c.weather_code}`,
      uvIndex: c.uv_index,
    };

    return {
      sourceId: 'open-meteo',
      ok: true,
      fetchedAt: new Date(),
      data,
      latencyMs: Date.now() - startTime,
    };
  } catch (err) {
    return sourceError<WeatherData>('open-meteo', startTime, err);
  }
}
