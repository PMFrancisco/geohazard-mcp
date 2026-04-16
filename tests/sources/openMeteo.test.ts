import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchOpenMeteo } from '../../src/sources/openMeteo.js';
import { stubFetchOnce, stubFetchStatus } from './_helpers.js';

afterEach(() => vi.unstubAllGlobals());

describe('fetchOpenMeteo', () => {
  it('normalizes current weather to WeatherData', async () => {
    stubFetchOnce({
      current: {
        temperature_2m: 21.3,
        apparent_temperature: 22,
        relative_humidity_2m: 55,
        wind_speed_10m: 15,
        precipitation: 0,
        uv_index: 6,
        weather_code: 2,
      },
    });

    const r = await fetchOpenMeteo({ lat: 40, lon: -3 });
    expect(r.ok).toBe(true);
    expect(r.sourceId).toBe('open-meteo');
    expect(r.data).toMatchObject({
      tempC: 21.3,
      feelsLikeC: 22,
      humidityPct: 55,
      windKmh: 15,
      precipitationMm: 0,
      condition: 'Partly cloudy',
      uvIndex: 6,
    });
  });

  it('falls back to "WMO <code>" for unknown weather codes', async () => {
    stubFetchOnce({
      current: {
        temperature_2m: 10,
        apparent_temperature: 10,
        relative_humidity_2m: 50,
        wind_speed_10m: 5,
        precipitation: 0,
        uv_index: 1,
        weather_code: 42,
      },
    });
    const r = await fetchOpenMeteo({ lat: 40, lon: -3 });
    expect(r.data!.condition).toBe('WMO 42');
  });

  it('returns ok=false on HTTP error', async () => {
    stubFetchStatus(500);
    const r = await fetchOpenMeteo({ lat: 40, lon: -3 });
    expect(r.ok).toBe(false);
  });
});
