import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchNoaaNws } from '../../src/sources/noaaNws.js';
import { stubFetchOnce, stubFetchStatus } from './_helpers.js';

afterEach(() => vi.unstubAllGlobals());

describe('fetchNoaaNws', () => {
  it('maps GeoJSON features to NWSData', async () => {
    stubFetchOnce({
      features: [
        {
          properties: {
            id: 'urn:nws:1',
            event: 'Flood Warning',
            severity: 'Severe',
            urgency: 'Immediate',
            headline: 'Flooding on the Rio Grande',
            description: 'x'.repeat(800),
            onset: '2026-04-16T10:00:00Z',
            expires: '2026-04-17T10:00:00Z',
          },
        },
      ],
    });

    const r = await fetchNoaaNws({ lat: 35, lon: -105 });
    expect(r.ok).toBe(true);
    expect(r.data!.totalAlerts).toBe(1);
    const alert = r.data!.activeAlerts[0];
    expect(alert.severity).toBe('Severe');
    expect(alert.description.length).toBe(500);
  });

  it('handles an empty features array', async () => {
    stubFetchOnce({ features: [] });
    const r = await fetchNoaaNws({ lat: 35, lon: -105 });
    expect(r.ok).toBe(true);
    expect(r.data!.totalAlerts).toBe(0);
  });

  it('returns ok=false on HTTP error', async () => {
    stubFetchStatus(500);
    const r = await fetchNoaaNws({ lat: 35, lon: -105 });
    expect(r.ok).toBe(false);
  });
});
