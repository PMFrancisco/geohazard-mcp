import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/logger/discrepancy.js', () => ({
  logDiscrepancy: vi.fn(),
}));

import { detectDiscrepancies } from '../../src/aggregator/compareSources.js';
import type { Coordinates, SourceResult } from '../../src/types/index.js';

const coords: Coordinates = { lat: 40, lon: -3 };

function mkResult<T>(
  sourceId: string,
  data: T | null,
  ok = true,
): SourceResult<T> {
  return {
    sourceId,
    ok,
    fetchedAt: new Date(),
    data,
    latencyMs: 10,
  };
}

describe('detectDiscrepancies', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns [] when there is only one source per field', () => {
    const res = detectDiscrepancies(coords, [
      mkResult('a', { pm25: 10 }),
      mkResult('b', { aqi: 50 }),
    ]);
    expect(res).toEqual([]);
  });

  it('returns [] when values agree within 5%', () => {
    const res = detectDiscrepancies(coords, [
      mkResult('a', { pm25: 10 }),
      mkResult('b', { pm25: 10.3 }),
    ]);
    expect(res).toEqual([]);
  });

  it('flags a discrepancy above 5% relative delta', () => {
    const res = detectDiscrepancies(coords, [
      mkResult('a', { pm25: 10 }),
      mkResult('b', { pm25: 15 }),
    ]);
    expect(res).toHaveLength(1);
    expect(res[0].field).toBe('pm25');
    expect(res[0].sourceA).toBe('a');
    expect(res[0].valueA).toBe(10);
    expect(res[0].sourceB).toBe('b');
    expect(res[0].valueB).toBe(15);
    expect(res[0].delta).toBe(5);
    expect(res[0].relativeDelta).toBeCloseTo(40);
  });

  it('skips likely unit mismatches (ratio ≥ 100x)', () => {
    const res = detectDiscrepancies(coords, [
      mkResult('a', { x: 1 }),
      mkResult('b', { x: 100 }),
    ]);
    expect(res).toEqual([]);
  });

  it('flags nested numeric fields by dotted path', () => {
    const res = detectDiscrepancies(coords, [
      mkResult('a', { nested: { temp: 20 } }),
      mkResult('b', { nested: { temp: 30 } }),
    ]);
    expect(res).toHaveLength(1);
    expect(res[0].field).toBe('nested.temp');
  });

  it('marks openaq vs open-meteo-aq pairs as expected', () => {
    const res = detectDiscrepancies(coords, [
      mkResult('openaq', { pm25: 10 }),
      mkResult('open-meteo-aq', { pm25: 15 }),
    ]);
    expect(res[0].expected).toBe(true);
  });

  it('ignores failed results', () => {
    const res = detectDiscrepancies(coords, [
      mkResult('a', { pm25: 10 }),
      mkResult('b', null, false),
    ]);
    expect(res).toEqual([]);
  });

  it('ignores zero-valued fields', () => {
    const res = detectDiscrepancies(coords, [
      mkResult('a', { pm25: 0 }),
      mkResult('b', { pm25: 0 }),
    ]);
    expect(res).toEqual([]);
  });
});
