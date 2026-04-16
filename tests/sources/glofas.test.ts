import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchGlofas } from '../../src/sources/glofas.js';
import { stubFetchOnce, stubFetchStatus } from './_helpers.js';

afterEach(() => vi.unstubAllGlobals());

describe('fetchGlofas', () => {
  it('maps max discharge to a return period', async () => {
    stubFetchOnce({
      daily: { river_discharge: [10, 100, 800, 2500, null] },
    });
    const r = await fetchGlofas({ lat: 40, lon: -3 });
    expect(r.ok).toBe(true);
    expect(r.data!.dischargeM3s).toBe(2500);
    expect(r.data!.returnPeriod).toBe('> 20y');
    expect(r.data!.forecastDays).toBe(4);
    expect(r.data!.riverName).toBeNull();
  });

  it('defaults to < 5y when discharge is low', async () => {
    stubFetchOnce({ daily: { river_discharge: [5, 10] } });
    const r = await fetchGlofas({ lat: 40, lon: -3 });
    expect(r.data!.returnPeriod).toBe('< 5y');
  });

  it('handles an empty discharge array', async () => {
    stubFetchOnce({ daily: {} });
    const r = await fetchGlofas({ lat: 40, lon: -3 });
    expect(r.ok).toBe(true);
    expect(r.data!.dischargeM3s).toBeNull();
    expect(r.data!.forecastDays).toBe(0);
  });

  it('returns ok=false on HTTP error', async () => {
    stubFetchStatus(500);
    const r = await fetchGlofas({ lat: 40, lon: -3 });
    expect(r.ok).toBe(false);
  });
});
