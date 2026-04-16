import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchOpenAQ } from '../../src/sources/openAQ.js';
import { stubFetchSequence, stubFetchOnce } from './_helpers.js';

const ORIGINAL_KEY = process.env.OPENAQ_API_KEY;

beforeEach(() => {
  process.env.OPENAQ_API_KEY = 'test-key';
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (ORIGINAL_KEY === undefined) delete process.env.OPENAQ_API_KEY;
  else process.env.OPENAQ_API_KEY = ORIGINAL_KEY;
});

describe('fetchOpenAQ', () => {
  it('picks a station with PM sensors and normalizes latest readings', async () => {
    stubFetchSequence([
      {
        body: {
          results: [
            {
              id: 1,
              name: 'No-PM station',
              coordinates: { latitude: 40, longitude: -3 },
              distance: 1000,
              sensors: [
                { id: 10, parameter: { id: 3, name: 'o3', units: 'ppm' } },
              ],
            },
            {
              id: 2,
              name: 'Main station',
              coordinates: { latitude: 40, longitude: -3 },
              distance: 3000,
              sensors: [
                { id: 20, parameter: { id: 1, name: 'pm25', units: 'µg/m³' } },
                { id: 21, parameter: { id: 2, name: 'pm10', units: 'µg/m³' } },
                { id: 22, parameter: { id: 3, name: 'o3', units: 'ppm' } },
              ],
            },
          ],
        },
      },
      {
        body: {
          results: [
            { sensorsId: 20, value: 15 },
            { sensorsId: 21, value: 30 },
            { sensorsId: 22, value: 0.05 }, // ppm → should multiply by 1960
          ],
        },
      },
    ]);

    const r = await fetchOpenAQ({ lat: 40, lon: -3 });
    expect(r.ok).toBe(true);
    expect(r.sourceId).toBe('openaq');
    expect(r.data!.source).toBe('openaq');
    expect(r.data!.pm25).toBe(15);
    expect(r.data!.pm10).toBe(30);
    expect(r.data!.o3).toBeCloseTo(98); // 0.05 * 1960
    expect(r.data!.stationDistanceKm).toBe(3);
  });

  it('returns ok=false when no stations are within 25 km', async () => {
    stubFetchOnce({ results: [] });
    const r = await fetchOpenAQ({ lat: 0, lon: 0 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/No stations/);
  });

  it('returns ok=false when OPENAQ_API_KEY is missing', async () => {
    delete process.env.OPENAQ_API_KEY;
    const r = await fetchOpenAQ({ lat: 40, lon: -3 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/OPENAQ_API_KEY/);
  });
});
