import type { Coordinates, FloodData, SourceResult } from '../types/index.js';
import { fetchWithTimeout, sourceError } from './http.js';

/**
 * Flood forecast via Open-Meteo Flood API (powered by GloFAS/CEMS data).
 *
 * The Copernicus EWDS/CDS API is a bulk-download system (async job → GRIB file),
 * not suited for real-time point queries. Open-Meteo wraps the same GloFAS river
 * discharge data as an instant point-query REST API — same data, <1s latency.
 *
 * GLOFAS_KEY is not required.
 */
export async function fetchGlofas(
  coords: Coordinates,
): Promise<SourceResult<FloodData>> {
  const startTime = Date.now();

  try {
    const url =
      `https://flood-api.open-meteo.com/v1/flood` +
      `?latitude=${coords.lat}&longitude=${coords.lon}` +
      `&daily=river_discharge` +
      `&forecast_days=30`;

    const res = await fetchWithTimeout(url, { timeoutMs: 8000 });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = (await res.json()) as {
      daily?: { river_discharge?: (number | null)[] };
    };

    const discharges = (json.daily?.river_discharge ?? []).filter(
      (v): v is number => v !== null,
    );
    const maxDischarge = discharges.length > 0 ? Math.max(...discharges) : null;

    let returnPeriod: FloodData['returnPeriod'] = '< 5y';
    if (maxDischarge !== null) {
      if (maxDischarge > 5000) returnPeriod = '> 100y';
      else if (maxDischarge > 2000) returnPeriod = '> 20y';
      else if (maxDischarge > 500) returnPeriod = '> 5y';
    }

    return {
      sourceId: 'glofas',
      ok: true,
      fetchedAt: new Date(),
      data: {
        returnPeriod,
        dischargeM3s: maxDischarge,
        forecastDays: discharges.length,
        riverName: null,
      },
      latencyMs: Date.now() - startTime,
    };
  } catch (err) {
    return sourceError<FloodData>('glofas', startTime, err);
  }
}
