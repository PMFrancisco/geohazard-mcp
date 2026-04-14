import type { SourceResult } from '../types/index.js';

export async function fetchWithTimeout(
  url: string,
  init: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = 5000, ...rest } = init;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...rest, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function sourceError<T>(
  sourceId: string,
  startedAt: number,
  err: unknown,
): SourceResult<T> {
  return {
    sourceId,
    ok: false,
    fetchedAt: new Date(),
    data: null,
    error: String(err),
    latencyMs: Date.now() - startedAt,
  };
}
