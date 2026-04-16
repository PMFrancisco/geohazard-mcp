import type {
  CompareSourcesResponse,
  Coordinates,
  Discrepancy,
  SourceResult,
} from '../types/index.js';
import { randomUUID } from 'node:crypto';
import { fetchAllSources } from './index.js';
import { logDiscrepancy } from '../logger/discrepancy.js';

/**
 * Detect numeric discrepancies (>5% delta) between sources that share
 * comparable fields (e.g., both AQ sources report PM2.5).
 */
export function detectDiscrepancies(
  location: Coordinates,
  results: SourceResult<unknown>[],
): Discrepancy[] {
  const discrepancies: Discrepancy[] = [];

  const numericFields = new Map<
    string,
    { sourceId: string; value: number }[]
  >();

  for (const r of results) {
    if (!r.ok || !r.data || typeof r.data !== 'object') continue;
    const data = r.data as Record<string, unknown>;
    extractNumericFields(r.sourceId, data, '', numericFields);
  }

  for (const [field, entries] of numericFields) {
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i];
        const b = entries[j];
        const delta = Math.abs(a.value - b.value);
        const avg = (Math.abs(a.value) + Math.abs(b.value)) / 2;
        const relativeDelta = avg > 0 ? (delta / avg) * 100 : 0;

        // Skip likely units mismatches (values differ by >100x)
        const ratio =
          Math.max(Math.abs(a.value), Math.abs(b.value)) /
          Math.min(Math.abs(a.value), Math.abs(b.value));
        if (relativeDelta > 5 && ratio < 100) {
          const pair = new Set([a.sourceId, b.sourceId]);
          const expected = pair.has('openaq') && pair.has('open-meteo-aq');
          const disc: Discrepancy = {
            id: randomUUID(),
            timestampUtc: new Date().toISOString(),
            location,
            field,
            sourceA: a.sourceId,
            valueA: a.value,
            sourceB: b.sourceId,
            valueB: b.value,
            delta,
            relativeDelta: Math.round(relativeDelta * 10) / 10,
            ...(expected ? { expected: true } : {}),
          };
          discrepancies.push(disc);

          logDiscrepancy({
            location,
            field,
            sourceA: a.sourceId,
            valueA: a.value,
            sourceB: b.sourceId,
            valueB: b.value,
          });
        }
      }
    }
  }

  return discrepancies;
}

function extractNumericFields(
  sourceId: string,
  obj: Record<string, unknown>,
  prefix: string,
  out: Map<string, { sourceId: string; value: number }[]>,
): void {
  for (const [key, val] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof val === 'number' && isFinite(val) && val !== 0) {
      const existing = out.get(path) ?? [];
      existing.push({ sourceId, value: val });
      out.set(path, existing);
    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
      extractNumericFields(sourceId, val as Record<string, unknown>, path, out);
    }
  }
}

export async function compareSources(params: {
  lat: number;
  lon: number;
}): Promise<CompareSourcesResponse> {
  const coords: Coordinates = { lat: params.lat, lon: params.lon };

  // Uses the same shared fetch + logging as getConditions
  const { all } = await fetchAllSources(coords);

  const sources: CompareSourcesResponse['sources'] = {};
  for (const r of all) {
    sources[r.sourceId] = {
      ok: r.ok,
      data: r.data,
      latencyMs: r.latencyMs,
      ...(r.error ? { error: r.error } : {}),
      ...(r.reason ? { reason: r.reason } : {}),
      ...(r.envVar ? { envVar: r.envVar } : {}),
    };
  }

  const discrepancies = detectDiscrepancies(coords, all);

  return {
    location: coords,
    timestampUtc: new Date().toISOString(),
    sources,
    discrepancies,
  };
}
