import type {
  Coordinates,
  SeismicData,
  SeismicEvent,
  SourceResult,
} from '../types/index.js';

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

export async function fetchUSGSEarthquake(
  coords: Coordinates,
  radiusKm = 500,
): Promise<SourceResult<SeismicData>> {
  const startTime = Date.now();
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 5000);

  try {
    const now = new Date();
    const lookback = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const url =
      `https://earthquake.usgs.gov/fdsnws/event/1/query` +
      `?format=geojson` +
      `&latitude=${coords.lat}&longitude=${coords.lon}` +
      `&maxradiuskm=${radiusKm}` +
      `&starttime=${lookback.toISOString()}`;

    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = (await res.json()) as {
      features: Array<{
        id: string;
        properties: {
          mag: number;
          place: string;
          time: number;
          tsunami: number;
        };
        geometry: { coordinates: [number, number, number] };
      }>;
    };

    const events: SeismicEvent[] = json.features.map((f) => {
      const [lon, lat, depth] = f.geometry.coordinates;
      const distanceKm = haversineKm(coords.lat, coords.lon, lat, lon);
      return {
        id: f.id,
        magnitude: f.properties.mag,
        depthKm: depth,
        distanceKm: Math.round(distanceKm * 10) / 10,
        place: f.properties.place,
        timeUtc: new Date(f.properties.time).toISOString(),
        tsunami: f.properties.tsunami === 1,
      };
    });

    events.sort((a, b) => a.distanceKm - b.distanceKm);

    const magnitudes = events.map((e) => e.magnitude);

    const data: SeismicData = {
      recentEvents: events,
      nearestEventDistanceKm: events.length > 0 ? events[0].distanceKm : null,
      maxMagnitude: magnitudes.length > 0 ? Math.max(...magnitudes) : null,
    };

    return {
      sourceId: 'usgs-earthquake',
      ok: true,
      fetchedAt: new Date(),
      data,
      latencyMs: Date.now() - startTime,
    };
  } catch (err) {
    return {
      sourceId: 'usgs-earthquake',
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
