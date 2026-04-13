import type { Coordinates, NWSData, SourceResult } from '../types/index.js';

interface NWSFeature {
  properties: {
    id: string;
    event: string;
    severity: string;
    urgency: string;
    headline: string;
    description: string;
    onset: string;
    expires: string;
  };
}

export async function fetchNoaaNws(
  coords: Coordinates,
): Promise<SourceResult<NWSData>> {
  const startTime = Date.now();
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 5000);

  try {
    const url =
      `https://api.weather.gov/alerts/active` +
      `?point=${coords.lat},${coords.lon}`;

    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'planetary-risk/1.0' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = (await res.json()) as { features: NWSFeature[] };
    const features = json.features ?? [];

    const activeAlerts = features.map((f) => ({
      id: f.properties.id,
      event: f.properties.event,
      severity: f.properties.severity as
        | 'Extreme'
        | 'Severe'
        | 'Moderate'
        | 'Minor'
        | 'Unknown',
      urgency: f.properties.urgency,
      headline: f.properties.headline,
      description: f.properties.description?.slice(0, 500) ?? '',
      onset: f.properties.onset,
      expires: f.properties.expires,
    }));

    return {
      sourceId: 'noaa-nws',
      ok: true,
      fetchedAt: new Date(),
      data: { activeAlerts, totalAlerts: activeAlerts.length },
      latencyMs: Date.now() - startTime,
    };
  } catch (err) {
    return {
      sourceId: 'noaa-nws',
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
