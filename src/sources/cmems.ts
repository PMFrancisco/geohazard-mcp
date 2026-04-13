import type { Coordinates, MarineData, SourceResult } from '../types/index.js';

/**
 * Marine data via Open-Meteo Marine API.
 * Wave height, ocean currents — no API key required.
 */
export async function fetchCmems(
  coords: Coordinates,
): Promise<SourceResult<MarineData>> {
  const startTime = Date.now();
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 5000);

  try {
    const url =
      `https://marine-api.open-meteo.com/v1/marine` +
      `?latitude=${coords.lat}&longitude=${coords.lon}` +
      `&current=wave_height,ocean_current_velocity`;

    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = (await res.json()) as {
      current?: Record<string, number>;
    };
    const c = json.current ?? {};

    return {
      sourceId: 'marine',
      ok: true,
      fetchedAt: new Date(),
      data: {
        seaSurfaceTempC: null,
        waveHeightM: c.wave_height ?? null,
        currentSpeedKms: c.ocean_current_velocity ?? null,
        seaLevelAnomalyM: null,
      },
      latencyMs: Date.now() - startTime,
    };
  } catch (err) {
    return {
      sourceId: 'marine',
      ok: false,
      fetchedAt: new Date(),
      data: null,
      error: String(err),
      latencyMs: Date.now() - startTime,
    };
  } finally {
    clearTimeout(timeout);
  }
}
