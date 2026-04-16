import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchGdacs } from '../../src/sources/gdacs.js';
import { stubFetchOnce, stubFetchStatus } from './_helpers.js';

afterEach(() => vi.unstubAllGlobals());

const feature = (overrides: Record<string, unknown> = {}) => ({
  geometry: { coordinates: [-3, 40] },
  properties: {
    eventtype: 'TC',
    eventid: 1,
    name: 'Cyclone Test',
    alertlevel: 'Orange',
    alertscore: 2,
    iscurrent: 'true',
    country: 'ES',
    fromdate: '2026-04-15',
    todate: '2026-04-18',
    severitydata: { severity: 80, severitytext: 'Cat 3', severityunit: 'km/h' },
    ...overrides,
  },
});

describe('fetchGdacs', () => {
  it('filters non-current events and computes max alert level', async () => {
    stubFetchOnce({
      features: [
        feature(),
        feature({ eventtype: 'EQ', alertlevel: 'Red', iscurrent: 'true' }),
        feature({ iscurrent: 'false', alertlevel: 'Red' }),
      ],
    });

    const r = await fetchGdacs({ lat: 40, lon: -3 });
    expect(r.ok).toBe(true);
    expect(r.data!.events).toHaveLength(2);
    expect(r.data!.hasCyclone).toBe(true);
    expect(r.data!.maxAlertLevel).toBe('Red');
  });

  it('treats 404 as "no events"', async () => {
    stubFetchStatus(404);
    const r = await fetchGdacs({ lat: 40, lon: -3 });
    expect(r.ok).toBe(true);
    expect(r.data!.events).toEqual([]);
    expect(r.data!.maxAlertLevel).toBe('None');
  });

  it('returns ok=false on other HTTP errors', async () => {
    stubFetchStatus(500);
    const r = await fetchGdacs({ lat: 40, lon: -3 });
    expect(r.ok).toBe(false);
  });
});
