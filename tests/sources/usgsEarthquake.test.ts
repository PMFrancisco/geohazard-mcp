import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchUSGSEarthquake } from '../../src/sources/usgsEarthquake.js';
import { stubFetchOnce, stubFetchStatus } from './_helpers.js';

afterEach(() => vi.unstubAllGlobals());

describe('fetchUSGSEarthquake', () => {
  it('normalizes GeoJSON features into SeismicData', async () => {
    stubFetchOnce({
      features: [
        {
          id: 'us7000abcd',
          properties: {
            mag: 5.4,
            place: '10 km SE of Example',
            time: Date.parse('2026-04-16T10:00:00Z'),
            tsunami: 0,
          },
          geometry: { coordinates: [-3.5, 40.5, 12] },
        },
        {
          id: 'us7000dcba',
          properties: {
            mag: 6.1,
            place: 'Offshore',
            time: Date.parse('2026-04-16T11:00:00Z'),
            tsunami: 1,
          },
          geometry: { coordinates: [-3.1, 40.1, 20] },
        },
      ],
    });

    const r = await fetchUSGSEarthquake({ lat: 40, lon: -3 });
    expect(r.ok).toBe(true);
    expect(r.sourceId).toBe('usgs-earthquake');
    expect(r.data!.recentEvents).toHaveLength(2);
    expect(r.data!.maxMagnitude).toBe(6.1);
    // Sorted by distance ascending; closer event first
    expect(r.data!.recentEvents[0].id).toBe('us7000dcba');
    expect(r.data!.recentEvents[0].tsunami).toBe(true);
    expect(r.data!.nearestEventDistanceKm).toBe(
      r.data!.recentEvents[0].distanceKm,
    );
  });

  it('returns ok=false on HTTP error', async () => {
    stubFetchStatus(503);
    const r = await fetchUSGSEarthquake({ lat: 40, lon: -3 });
    expect(r.ok).toBe(false);
    expect(r.data).toBeNull();
    expect(r.error).toMatch(/HTTP 503/);
  });

  it('handles an empty feature list', async () => {
    stubFetchOnce({ features: [] });
    const r = await fetchUSGSEarthquake({ lat: 40, lon: -3 });
    expect(r.ok).toBe(true);
    expect(r.data!.recentEvents).toEqual([]);
    expect(r.data!.maxMagnitude).toBeNull();
    expect(r.data!.nearestEventDistanceKm).toBeNull();
  });
});
