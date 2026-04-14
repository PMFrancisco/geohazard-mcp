import type {
  Coordinates,
  FireData,
  FireHotspot,
  SourceResult,
} from '../types/index.js';
import { fetchWithTimeout, sourceError } from './http.js';

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

function parseCSV(csv: string): Record<string, string>[] {
  const lines = csv.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = lines[0].split(',');
  return lines.slice(1).map((line) => {
    const values = line.split(',');
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h.trim()] = values[i]?.trim() ?? '';
    });
    return row;
  });
}

export async function fetchNASAFirms(
  coords: Coordinates,
  firmsKey?: string,
): Promise<SourceResult<FireData>> {
  const startTime = Date.now();

  try {
    const key = firmsKey ?? process.env.NASA_FIRMS_KEY;
    if (!key) {
      throw new Error(
        'NASA_FIRMS_KEY not set — get a free key at https://firms.modaps.eosdis.nasa.gov/api/map_key/',
      );
    }

    // ±2° bounding box ≈ 220km
    const west = coords.lon - 2;
    const east = coords.lon + 2;
    const south = coords.lat - 2;
    const north = coords.lat + 2;

    const url =
      `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${key}` +
      `/VIIRS_SNPP_NRT/${west},${south},${east},${north}/1`;

    const res = await fetchWithTimeout(url, { timeoutMs: 8000 });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const csv = await res.text();
    const rows = parseCSV(csv);

    const hotspots: FireHotspot[] = rows.map((r) => {
      const lat = parseFloat(r.latitude);
      const lon = parseFloat(r.longitude);
      const distanceKm = haversineKm(coords.lat, coords.lon, lat, lon);
      return {
        lat,
        lon,
        brightness: parseFloat(r.bright_ti4) || 0,
        confidence: parseFloat(r.confidence) || 0,
        distanceKm: Math.round(distanceKm * 10) / 10,
      };
    });

    hotspots.sort((a, b) => a.distanceKm - b.distanceKm);

    const within100 = hotspots.filter((h) => h.distanceKm <= 100);
    const within500 = hotspots.filter((h) => h.distanceKm <= 500);
    const brightnesses = hotspots.map((h) => h.brightness);

    const data: FireData = {
      hotspotsNearby: hotspots.slice(0, 50), // cap response size
      totalHotspots100km: within100.length,
      totalHotspots500km: within500.length,
      maxBrightness: brightnesses.length > 0 ? Math.max(...brightnesses) : null,
      nearestDistanceKm: hotspots.length > 0 ? hotspots[0].distanceKm : null,
    };

    return {
      sourceId: 'nasa-firms',
      ok: true,
      fetchedAt: new Date(),
      data,
      latencyMs: Date.now() - startTime,
    };
  } catch (err) {
    return sourceError<FireData>('nasa-firms', startTime, err);
  }
}
