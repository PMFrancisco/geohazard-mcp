import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchSmithsonianGvp } from '../../src/sources/smithsonianGvp.js';
import { stubFetchOnce, stubFetchStatus } from './_helpers.js';

afterEach(() => vi.unstubAllGlobals());

describe('fetchSmithsonianGvp', () => {
  it('normalizes elevated volcanoes and sorts by distance', async () => {
    stubFetchOnce([
      {
        vName: 'Kilauea',
        vnum: '1',
        lat: 19.4,
        long: -155.3,
        alertLevel: 'WATCH',
        colorCode: 'ORANGE',
        noticeSynopsis: '',
        alertDate: '2026-04-16',
        obs: 'hvo',
      },
      {
        vName: 'Etna',
        vnum: '2',
        lat: 37.75,
        long: 14.99,
        alertLevel: 'WARNING',
        colorCode: 'RED',
        noticeSynopsis: '',
        alertDate: '2026-04-15',
        obs: 'ingv',
      },
    ]);

    const r = await fetchSmithsonianGvp({ lat: 38, lon: 15 });
    expect(r.ok).toBe(true);
    expect(r.data!.nearbyCount).toBe(2);
    expect(r.data!.recentActivity[0].volcanoName).toBe('Etna');
    expect(r.data!.recentActivity[0].activityLevel).toBe('Erupting');
    expect(r.data!.recentActivity[0].region).toBe('INGV');
    expect(r.data!.recentActivity[1].activityLevel).toBe('Elevated');
  });

  it('handles an empty list', async () => {
    stubFetchOnce([]);
    const r = await fetchSmithsonianGvp({ lat: 0, lon: 0 });
    expect(r.ok).toBe(true);
    expect(r.data!.nearbyCount).toBe(0);
  });

  it('returns ok=false on HTTP error', async () => {
    stubFetchStatus(500);
    const r = await fetchSmithsonianGvp({ lat: 0, lon: 0 });
    expect(r.ok).toBe(false);
  });
});
