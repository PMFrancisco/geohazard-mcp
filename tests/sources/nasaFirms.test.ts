import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchNASAFirms } from '../../src/sources/nasaFirms.js';
import { stubFetchOnce, stubFetchStatus } from './_helpers.js';

const ORIGINAL_KEY = process.env.NASA_FIRMS_KEY;

beforeEach(() => {
  process.env.NASA_FIRMS_KEY = 'test-key';
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (ORIGINAL_KEY === undefined) delete process.env.NASA_FIRMS_KEY;
  else process.env.NASA_FIRMS_KEY = ORIGINAL_KEY;
});

const csvHeader =
  'latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,satellite,instrument,confidence,version,bright_ti5,frp,daynight';

describe('fetchNASAFirms', () => {
  it('parses VIIRS CSV and filters low-confidence hotspots', async () => {
    const csv = [
      csvHeader,
      '40.1,-3.1,380,0.4,0.5,2026-04-16,1200,N,VIIRS,h,2.0,290,12,D',
      '40.5,-3.5,360,0.4,0.5,2026-04-16,1300,N,VIIRS,n,2.0,290,8,D',
      '39.9,-3.0,340,0.4,0.5,2026-04-16,1400,N,VIIRS,l,2.0,290,5,D', // dropped (low confidence)
    ].join('\n');
    stubFetchOnce(csv);

    const r = await fetchNASAFirms({ lat: 40, lon: -3 });
    expect(r.ok).toBe(true);
    expect(r.sourceId).toBe('nasa-firms');
    expect(r.data!.hotspotsNearby).toHaveLength(2);
    expect(r.data!.totalHotspots100km).toBe(2);
    expect(r.data!.maxBrightness).toBe(380);
    expect(r.data!.nearestDistanceKm).toBeLessThan(20);
    // Highest-confidence ('h' → 90) row passed through
    expect(r.data!.hotspotsNearby[0].confidence).toBeGreaterThanOrEqual(60);
  });

  it('handles an empty CSV (header only)', async () => {
    stubFetchOnce(csvHeader);
    const r = await fetchNASAFirms({ lat: 40, lon: -3 });
    expect(r.ok).toBe(true);
    expect(r.data!.hotspotsNearby).toEqual([]);
    expect(r.data!.nearestDistanceKm).toBeNull();
    expect(r.data!.maxBrightness).toBeNull();
  });

  it('returns ok=false when NASA_FIRMS_KEY is missing', async () => {
    delete process.env.NASA_FIRMS_KEY;
    const r = await fetchNASAFirms({ lat: 40, lon: -3 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/NASA_FIRMS_KEY/);
    expect(r.reason).toBe('missing_api_key');
    expect(r.envVar).toBe('NASA_FIRMS_KEY');
  });

  it('tags HTTP 403 as invalid_api_key', async () => {
    stubFetchStatus(403);
    const r = await fetchNASAFirms({ lat: 40, lon: -3 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('invalid_api_key');
    expect(r.envVar).toBe('NASA_FIRMS_KEY');
  });

  it('tags "Invalid MAP_KEY" response body as invalid_api_key', async () => {
    stubFetchOnce('Invalid MAP_KEY.');
    const r = await fetchNASAFirms({ lat: 40, lon: -3 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('invalid_api_key');
    expect(r.envVar).toBe('NASA_FIRMS_KEY');
  });

  it('tags HTTP 400 + "Invalid MAP_KEY" body as invalid_api_key (real FIRMS behavior)', async () => {
    stubFetchOnce('Invalid MAP_KEY.', {
      status: 400,
      statusText: 'Bad Request',
    });
    const r = await fetchNASAFirms({ lat: 40, lon: -3 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe('invalid_api_key');
    expect(r.envVar).toBe('NASA_FIRMS_KEY');
  });

  it('returns ok=false on HTTP error', async () => {
    stubFetchStatus(500);
    const r = await fetchNASAFirms({ lat: 40, lon: -3 });
    expect(r.ok).toBe(false);
    expect(r.reason).toBeUndefined();
  });
});
