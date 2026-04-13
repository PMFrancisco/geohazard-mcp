import type { Coordinates, SourceResult } from '../types/index.js';

export interface GdacsEvent {
  eventType: 'EQ' | 'TC' | 'FL' | 'VO';
  eventId: number;
  name: string;
  alertLevel: 'Green' | 'Orange' | 'Red';
  alertScore: number;
  severity: string;
  severityValue: number;
  severityUnit: string;
  country: string;
  coordinates: { lat: number; lon: number };
  fromDate: string;
  toDate: string;
}

export interface GdacsData {
  events: GdacsEvent[];
  totalEvents: number;
  hasCyclone: boolean;
  maxAlertLevel: 'Green' | 'Orange' | 'Red' | 'None';
}

interface GdacsFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    eventtype: string;
    eventid: number;
    name: string;
    alertlevel: string;
    alertscore: number;
    iscurrent: string;
    country: string;
    fromdate: string;
    todate: string;
    severitydata: {
      severity: number;
      severitytext: string;
      severityunit: string;
    };
  };
}

/**
 * GDACS — Global Disaster Alert and Coordination System.
 * Earthquakes, tropical cyclones, floods, volcanoes.
 * Queries a bounding box around the coordinates.
 * No API key required.
 */
export async function fetchGdacs(
  coords: Coordinates,
): Promise<SourceResult<GdacsData>> {
  const startTime = Date.now();
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 8000);

  try {
    // Build ~5° bounding box around the point
    const delta = 5;
    const minLon = coords.lon - delta;
    const maxLon = coords.lon + delta;
    const minLat = coords.lat - delta;
    const maxLat = coords.lat + delta;
    const wkt = `POLYGON((${minLon} ${minLat},${maxLon} ${minLat},${maxLon} ${maxLat},${minLon} ${maxLat},${minLon} ${minLat}))`;

    const url =
      `https://www.gdacs.org/gdacsapi/api/Events/geteventlist/eventsbyarea` +
      `?geometryArea=${encodeURIComponent(wkt)}` +
      `&days=4`;

    const res = await fetch(url, { signal: ctrl.signal });

    // GDACS returns 404 when no events exist in the bounding box
    if (res.status === 404) {
      return {
        sourceId: 'gdacs',
        ok: true,
        fetchedAt: new Date(),
        data: {
          events: [],
          totalEvents: 0,
          hasCyclone: false,
          maxAlertLevel: 'None' as const,
        },
        latencyMs: Date.now() - startTime,
      };
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const json = (await res.json()) as {
      features?: GdacsFeature[];
    };

    const features = (json.features ?? []).filter(
      (f) => f.properties.iscurrent === 'true',
    );

    const events: GdacsEvent[] = features.map((f) => ({
      eventType: f.properties.eventtype as GdacsEvent['eventType'],
      eventId: f.properties.eventid,
      name: f.properties.name,
      alertLevel: f.properties.alertlevel as GdacsEvent['alertLevel'],
      alertScore: f.properties.alertscore,
      severity: f.properties.severitydata?.severitytext ?? '',
      severityValue: f.properties.severitydata?.severity ?? 0,
      severityUnit: f.properties.severitydata?.severityunit ?? '',
      country: f.properties.country,
      coordinates: {
        lat: f.geometry.coordinates[1],
        lon: f.geometry.coordinates[0],
      },
      fromDate: f.properties.fromdate,
      toDate: f.properties.todate,
    }));

    const alertLevels = events.map((e) => e.alertLevel);
    let maxAlertLevel: GdacsData['maxAlertLevel'] = 'None';
    if (alertLevels.includes('Red')) maxAlertLevel = 'Red';
    else if (alertLevels.includes('Orange')) maxAlertLevel = 'Orange';
    else if (alertLevels.includes('Green')) maxAlertLevel = 'Green';

    return {
      sourceId: 'gdacs',
      ok: true,
      fetchedAt: new Date(),
      data: {
        events,
        totalEvents: events.length,
        hasCyclone: events.some((e) => e.eventType === 'TC'),
        maxAlertLevel,
      },
      latencyMs: Date.now() - startTime,
    };
  } catch (err) {
    return {
      sourceId: 'gdacs',
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
