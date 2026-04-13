import type {
  Coordinates,
  SourceResult,
  VolcanicData,
} from '../types/index.js';

interface USGSVolcanoAlert {
  vName: string;
  vnum: string;
  lat: number;
  long: number;
  alertLevel: string;
  colorCode: string;
  noticeSynopsis: string;
  alertDate: string;
  obs: string;
}

/**
 * USGS Volcano Hazards Program — elevated volcano alerts.
 * Returns all volcanoes at ADVISORY (yellow), WATCH (orange), or WARNING (red).
 * No API key required.
 */
export async function fetchSmithsonianGvp(
  _coords: Coordinates,
): Promise<SourceResult<VolcanicData>> {
  const startTime = Date.now();
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 5000);

  try {
    const url = 'https://volcanoes.usgs.gov/vsc/api/volcanoApi/elevated';
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const alerts = (await res.json()) as USGSVolcanoAlert[];

    const recentActivity = alerts.map((a) => ({
      volcanoName: a.vName,
      region: a.obs.toUpperCase(),
      activityLevel: mapAlertLevel(a.alertLevel, a.colorCode),
      date: a.alertDate,
    }));

    return {
      sourceId: 'smithsonian-gvp',
      ok: true,
      fetchedAt: new Date(),
      data: {
        recentActivity,
        nearbyCount: recentActivity.length,
      },
      latencyMs: Date.now() - startTime,
    };
  } catch (err) {
    return {
      sourceId: 'smithsonian-gvp',
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

function mapAlertLevel(level: string, color: string): string {
  if (color === 'RED' || level === 'WARNING') return 'Erupting';
  if (color === 'ORANGE' || level === 'WATCH') return 'Elevated';
  if (color === 'YELLOW' || level === 'ADVISORY') return 'Warning';
  return 'Normal';
}
