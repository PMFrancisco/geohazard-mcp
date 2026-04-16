import { describe, it, expect } from 'vitest';
import { calculateConfidence } from '../../src/confidence/static.js';
import { SOURCES } from '../../src/sources/registry.js';
import type { Coordinates, SourceResult } from '../../src/types/index.js';

const coords: Coordinates = { lat: 40, lon: -3 };

function mkResult(
  sourceId: string,
  ok: boolean,
  ageMinutes = 0,
): SourceResult<unknown> {
  return {
    sourceId,
    ok,
    fetchedAt: new Date(Date.now() - ageMinutes * 60_000),
    data: ok ? {} : null,
    latencyMs: 10,
  };
}

const usSources = SOURCES.filter((s) => s.appliesTo(coords));

describe('calculateConfidence', () => {
  it('returns 0 / estimate when no sources apply', () => {
    const result = calculateConfidence([], { lat: 0, lon: 0 });
    expect(result.overall).toBe(0);
    expect(result.level).toBe('estimate');
  });

  it('is 1.0 when every applicable source is ok and fresh', () => {
    const results = usSources.map((s) => mkResult(s.id, true));
    const conf = calculateConfidence(results, coords);
    expect(conf.overall).toBe(1);
    expect(conf.level).toBe('reliable');
    expect(conf.okSources.length).toBe(usSources.length);
    expect(conf.failedSources).toEqual([]);
  });

  it('treats stale sources as failures', () => {
    const first = usSources[0];
    const stale = mkResult(first.id, true, first.freshnessMinutes * 3);
    const fresh = usSources.slice(1).map((s) => mkResult(s.id, true));
    const conf = calculateConfidence([stale, ...fresh], coords);
    expect(conf.failedSources).toContain(first.id);
    expect(conf.overall).toBeLessThan(1);
  });

  it('excludes non-applicable sources from the ratio', () => {
    const farCoords: Coordinates = { lat: 0, lon: 0 };
    const applicable = SOURCES.filter((s) => s.appliesTo(farCoords));
    const notApplicable = SOURCES.filter((s) => !s.appliesTo(farCoords));
    if (notApplicable.length === 0) return;
    const results = [
      ...applicable.map((s) => mkResult(s.id, true)),
      ...notApplicable.map((s) => mkResult(s.id, false)),
    ];
    const conf = calculateConfidence(results, farCoords);
    expect(conf.overall).toBe(1);
    expect(conf.notApplicableSources.sort()).toEqual(
      notApplicable.map((s) => s.id).sort(),
    );
  });

  it('maps overall to level thresholds', () => {
    const pickLevel = (okFraction: number) => {
      const sources = usSources;
      const okCount = Math.round(sources.length * okFraction);
      const results = sources.map((s, i) =>
        mkResult(s.id, i < okCount ? true : false),
      );
      return calculateConfidence(results, coords);
    };
    expect(pickLevel(1).level).toBe('reliable');
    expect(pickLevel(0.7).level).toBe('partial');
    expect(pickLevel(0.5).level).toBe('limited');
    expect(pickLevel(0.2).level).toBe('estimate');
  });
});
