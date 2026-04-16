import { describe, it, expect } from 'vitest';
import { buildConfigHints } from '../../src/aggregator/index.js';
import type { Coordinates, SourceResult } from '../../src/types/index.js';

const coords: Coordinates = { lat: 40, lon: -3 };

function failedWithReason(
  sourceId: string,
  reason: 'missing_api_key' | 'invalid_api_key',
  envVar: string,
): SourceResult<unknown> {
  return {
    sourceId,
    ok: false,
    fetchedAt: new Date(),
    data: null,
    error: `${envVar} problem`,
    reason,
    envVar,
    latencyMs: 0,
  };
}

function okResult(sourceId: string): SourceResult<unknown> {
  return {
    sourceId,
    ok: true,
    fetchedAt: new Date(),
    data: {},
    latencyMs: 5,
  };
}

describe('buildConfigHints', () => {
  it('emits a hint for each keyed source that reports missing_api_key', () => {
    const hints = buildConfigHints(
      [
        failedWithReason('openaq', 'missing_api_key', 'OPENAQ_API_KEY'),
        failedWithReason('nasa-firms', 'missing_api_key', 'NASA_FIRMS_KEY'),
        okResult('open-meteo'),
      ],
      coords,
    );

    expect(hints).toHaveLength(2);
    const byEnv = Object.fromEntries(hints.map((h) => [h.envVar, h]));
    expect(byEnv.OPENAQ_API_KEY.sourceId).toBe('openaq');
    expect(byEnv.OPENAQ_API_KEY.reason).toBe('missing_api_key');
    expect(byEnv.OPENAQ_API_KEY.message).toMatch(/OPENAQ_API_KEY/);
    expect(byEnv.OPENAQ_API_KEY.message).toMatch(/openaq/);
    expect(byEnv.OPENAQ_API_KEY.confidenceImpact).toBeGreaterThan(0);
    expect(byEnv.NASA_FIRMS_KEY.sourceId).toBe('nasa-firms');
    expect(byEnv.NASA_FIRMS_KEY.reason).toBe('missing_api_key');
  });

  it('distinguishes invalid_api_key from missing_api_key in the message', () => {
    const hints = buildConfigHints(
      [failedWithReason('openaq', 'invalid_api_key', 'OPENAQ_API_KEY')],
      coords,
    );
    expect(hints).toHaveLength(1);
    expect(hints[0].reason).toBe('invalid_api_key');
    expect(hints[0].message).toMatch(/rejected/i);
  });

  it('returns [] when no source carries a reason', () => {
    const hints = buildConfigHints(
      [
        okResult('open-meteo'),
        {
          sourceId: 'usgs-earthquake',
          ok: false,
          fetchedAt: new Date(),
          data: null,
          error: 'HTTP 500',
          latencyMs: 5,
        },
      ],
      coords,
    );
    expect(hints).toEqual([]);
  });
});
