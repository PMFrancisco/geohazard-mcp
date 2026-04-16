import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchOpenMeteoAq } from '../../src/sources/openMeteoAq.js';
import { stubFetchOnce, stubFetchStatus } from './_helpers.js';

afterEach(() => vi.unstubAllGlobals());

describe('fetchOpenMeteoAq', () => {
  it('normalizes current pollutants to AirQualityData', async () => {
    stubFetchOnce({
      current: {
        pm2_5: 12,
        pm10: 20,
        nitrogen_dioxide: 25,
        ozone: 40,
        carbon_monoxide: 200,
      },
    });

    const r = await fetchOpenMeteoAq({ lat: 40, lon: -3 });
    expect(r.ok).toBe(true);
    expect(r.sourceId).toBe('open-meteo-aq');
    expect(r.data!.source).toBe('open-meteo-aq');
    expect(r.data!.pm25).toBe(12);
    expect(r.data!.pm10).toBe(20);
    expect(r.data!.no2).toBe(25);
    expect(r.data!.o3).toBe(40);
    expect(r.data!.co).toBe(200);
    expect(typeof r.data!.aqi).toBe('number');
    expect(Array.isArray(r.data!.whoExceedances)).toBe(true);
  });

  it('defaults missing pollutants to 0 and omits co when missing', async () => {
    stubFetchOnce({ current: {} });
    const r = await fetchOpenMeteoAq({ lat: 40, lon: -3 });
    expect(r.ok).toBe(true);
    expect(r.data!.pm25).toBe(0);
    expect(r.data!.pm10).toBe(0);
    expect(r.data!.no2).toBe(0);
    expect(r.data!.o3).toBe(0);
    expect(r.data).not.toHaveProperty('co');
  });

  it('returns ok=false on HTTP error', async () => {
    stubFetchStatus(500);
    const r = await fetchOpenMeteoAq({ lat: 40, lon: -3 });
    expect(r.ok).toBe(false);
  });
});
