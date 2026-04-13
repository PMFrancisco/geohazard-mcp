import { appendFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Coordinates, SourceResult } from '../types/index.js';

const LOG_DIR = process.env.LOG_DIR ?? './logs';

async function ensureDir() {
  await mkdir(LOG_DIR, { recursive: true });
}

function append(file: string, data: object): void {
  const filePath = path.join(LOG_DIR, file);
  // Fire-and-forget — never throw into the aggregator
  ensureDir()
    .then(() => appendFile(filePath, JSON.stringify(data) + '\n'))
    .catch(() => {
      /* swallow */
    });
}

export function logSourceCall(
  result: SourceResult<unknown> & { location: Coordinates },
): void {
  append('sources.jsonl', {
    id: randomUUID(),
    timestampUtc: result.fetchedAt.toISOString(),
    sourceId: result.sourceId,
    location: result.location,
    ok: result.ok,
    latencyMs: result.latencyMs,
    ...(result.error ? { error: result.error } : {}),
  });
}

export function logDiscrepancy(entry: {
  location: Coordinates;
  field: string;
  sourceA: string;
  valueA: number;
  sourceB: string;
  valueB: number;
}): void {
  const delta = Math.abs(entry.valueA - entry.valueB);
  const avg = (Math.abs(entry.valueA) + Math.abs(entry.valueB)) / 2;
  const relativeDelta = avg > 0 ? (delta / avg) * 100 : 0;

  // Only log if >5% disagreement
  if (relativeDelta <= 5) return;

  append('discrepancies.jsonl', {
    id: randomUUID(),
    timestampUtc: new Date().toISOString(),
    location: entry.location,
    field: entry.field,
    sourceA: entry.sourceA,
    valueA: entry.valueA,
    sourceB: entry.sourceB,
    valueB: entry.valueB,
    delta,
    relativeDelta: Math.round(relativeDelta * 10) / 10,
  });
}
