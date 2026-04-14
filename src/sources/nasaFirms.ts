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

    // VIIRS_SNPP_NRT reports confidence as letter codes (l/n/h), not numeric.
    // Parsing with parseFloat() silently yields NaN → 0, rendering the field
    // unusable. Map to a numeric scale so downstream scoring can use it.
    const viirsConfidence = (raw: string): number => {
      const c = raw.trim().toLowerCase();
      if (c === 'h') return 90;
      if (c === 'n') return 60;
      if (c === 'l') return 20;
      return parseFloat(raw) || 0;
    };

    const hotspots: FireHotspot[] = rows.map((r) => {
      const lat = parseFloat(r.latitude);
      const lon = parseFloat(r.longitude);
      const distanceKm = haversineKm(coords.lat, coords.lon, lat, lon);
      return {
        lat,
        lon,
        brightness: parseFloat(r.bright_ti4) || 0,
        confidence: viirsConfidence(r.confidence),
        distanceKm: Math.round(distanceKm * 10) / 10,
      };
    });

    hotspots.sort((a, b) => a.distanceKm - b.distanceKm);

    // Drop hotspots south of the Antarctic Convergence (~-60°): thermal
    // anomalies over Antarctic ice sheets (ice reflections, research-station
    // geothermal signatures, sensor glitches) are known FIRMS artifacts, not
    // real fires.
    // Also drop low-confidence detections (VIIRS 'l' code, ~20) — these are
    // flagged by the VIIRS algorithm as likely false alarms (cold pixels,
    // edge effects, industrial thermal pollution).
    const filteredHotspots = hotspots.filter(
      (h) => h.lat >= -60 && h.confidence >= 30,
    );

    const within100 = filteredHotspots.filter((h) => h.distanceKm <= 100);
    const within500 = filteredHotspots.filter((h) => h.distanceKm <= 500);
    const brightnesses = filteredHotspots.map((h) => h.brightness);

    const data: FireData = {
      hotspotsNearby: filteredHotspots.slice(0, 50), // cap response size
      totalHotspots100km: within100.length,
      totalHotspots500km: within500.length,
      maxBrightness: brightnesses.length > 0 ? Math.max(...brightnesses) : null,
      nearestDistanceKm:
        filteredHotspots.length > 0 ? filteredHotspots[0].distanceKm : null,
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
