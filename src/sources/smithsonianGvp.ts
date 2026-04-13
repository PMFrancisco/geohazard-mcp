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

function haversineKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * USGS Volcano Hazards Program — elevated volcano alerts.
 * Returns all volcanoes at ADVISORY (yellow), WATCH (orange), or WARNING (red).
 * No API key required.
 */
export async function fetchSmithsonianGvp(
  coords: Coordinates,
): Promise<SourceResult<VolcanicData>> {
  const startTime = Date.now();
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 5000);

  try {
    const url = 'https://volcanoes.usgs.gov/vsc/api/volcanoApi/elevated';
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const alerts = (await res.json()) as USGSVolcanoAlert[];

    const recentActivity = alerts.map((a) => {
      const distanceKm = haversineKm(coords.lat, coords.lon, a.lat, a.long);
      return {
        volcanoName: a.vName,
        region: a.obs.toUpperCase(),
        activityLevel: mapAlertLevel(a.alertLevel, a.colorCode),
        date: a.alertDate,
        lat: a.lat,
        lon: a.long,
        distanceKm: Math.round(distanceKm * 10) / 10,
      };
    });

    recentActivity.sort((a, b) => a.distanceKm - b.distanceKm);

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
