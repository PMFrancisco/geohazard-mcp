import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchCmems } from '../../src/sources/cmems.js';
import { stubFetchOnce, stubFetchStatus } from './_helpers.js';

afterEach(() => vi.unstubAllGlobals());

describe('fetchCmems', () => {
  it('normalizes marine current fields', async () => {
    stubFetchOnce({
      current: { wave_height: 1.5, ocean_current_velocity: 0.8 },
    });
    const r = await fetchCmems({ lat: 40, lon: -3 });
    expect(r.ok).toBe(true);
    expect(r.sourceId).toBe('marine');
    expect(r.data).toEqual({
      seaSurfaceTempC: null,
      waveHeightM: 1.5,
      currentSpeedKms: 0.8,
      seaLevelAnomalyM: null,
    });
  });

  it('sets wave and current to null when missing', async () => {
    stubFetchOnce({});
    const r = await fetchCmems({ lat: 40, lon: -3 });
    expect(r.ok).toBe(true);
    expect(r.data!.waveHeightM).toBeNull();
    expect(r.data!.currentSpeedKms).toBeNull();
  });

  it('returns ok=false on HTTP error', async () => {
    stubFetchStatus(500);
    const r = await fetchCmems({ lat: 40, lon: -3 });
    expect(r.ok).toBe(false);
  });
});
