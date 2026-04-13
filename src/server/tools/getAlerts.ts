import { z } from 'zod';
import { getConditions } from '../../aggregator/index.js';

export const getAlertsTool = {
  description:
    'Active natural-hazard alerts near a coordinate (seismic, fire, severe weather)',
  schema: z.object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    radius_km: z.number().optional().default(500),
  }),
  handler: async ({
    lat,
    lon,
    radius_km,
  }: {
    lat: number;
    lon: number;
    radius_km?: number;
  }) => {
    const data = await getConditions({ lat, lon }, { radiusKm: radius_km });

    const alerts: Array<{
      type: string;
      severity: string;
      description: string;
    }> = [];

    if (data.seismic) {
      for (const eq of data.seismic.recentEvents) {
        if (eq.magnitude >= 4.0) {
          alerts.push({
            type: 'seismic',
            severity: eq.magnitude >= 6.0 ? 'high' : 'moderate',
            description: `M${eq.magnitude} earthquake at ${eq.place} (${eq.distanceKm} km away)`,
          });
        }
      }
    }

    if (data.fire) {
      if (data.fire.totalHotspots100km > 0) {
        alerts.push({
          type: 'fire',
          severity: data.fire.totalHotspots100km >= 10 ? 'high' : 'moderate',
          description: `${data.fire.totalHotspots100km} fire hotspot(s) within 100 km`,
        });
      }
    }

    if (data.weather) {
      if (data.weather.windKmh >= 80) {
        alerts.push({
          type: 'weather',
          severity: data.weather.windKmh >= 120 ? 'high' : 'moderate',
          description: `Severe wind: ${data.weather.windKmh} km/h`,
        });
      }
      if (data.weather.precipitationMm >= 50) {
        alerts.push({
          type: 'weather',
          severity: 'moderate',
          description: `Heavy precipitation: ${data.weather.precipitationMm} mm`,
        });
      }
    }

    return {
      location: data.location,
      timestampUtc: data.timestampUtc,
      alertCount: alerts.length,
      alerts,
      sourcesQueried: data.sourcesQueried,
      sourcesFailed: data.sourcesFailed,
    };
  },
};
