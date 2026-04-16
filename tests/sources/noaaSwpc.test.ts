import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchNoaaSwpc } from '../../src/sources/noaaSwpc.js';
import { stubFetchSequence, stubFetchStatus } from './_helpers.js';

afterEach(() => vi.unstubAllGlobals());

describe('fetchNoaaSwpc', () => {
  it('reads the latest Kp row and wires solar wind speed', async () => {
    stubFetchSequence([
      {
        body: [
          ['time_tag', 'Kp', 'Kp_fraction', 'a_running', 'station_count'],
          ['2026-04-16 00:00', '3', '3.0', '10', '8'],
          ['2026-04-16 03:00', '5', '5.0', '20', '8'],
        ],
      },
      { body: { WindSpeed: '412' } },
    ]);

    const r = await fetchNoaaSwpc({ lat: 40, lon: -3 });
    expect(r.ok).toBe(true);
    expect(r.data!.kpIndex).toBe(5);
    expect(r.data!.kpCategory).toBe('Active');
    expect(r.data!.solarWindSpeedKms).toBe(412);
    expect(r.data!.geomagneticStorm).toBe(true);
    expect(r.data!.auroraAlert).toBe(true);
  });

  it('still succeeds when solar wind fetch fails', async () => {
    stubFetchSequence([
      {
        body: [
          ['time_tag', 'Kp'],
          ['2026-04-16 00:00', '2'],
        ],
      },
      { body: '', init: { status: 503 } },
    ]);
    const r = await fetchNoaaSwpc({ lat: 40, lon: -3 });
    expect(r.ok).toBe(true);
    expect(r.data!.kpIndex).toBe(2);
    expect(r.data!.kpCategory).toBe('Quiet');
    expect(r.data!.solarWindSpeedKms).toBeNull();
    expect(r.data!.geomagneticStorm).toBe(false);
    expect(r.data!.auroraAlert).toBe(false);
  });

  it('returns ok=false when there are no Kp rows', async () => {
    stubFetchSequence([{ body: [['header only']] }]);
    const r = await fetchNoaaSwpc({ lat: 40, lon: -3 });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/No Kp data/);
  });

  it('returns ok=false on HTTP error', async () => {
    stubFetchStatus(500);
    const r = await fetchNoaaSwpc({ lat: 40, lon: -3 });
    expect(r.ok).toBe(false);
  });
});
