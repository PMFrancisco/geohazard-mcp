import { z } from 'zod';
import { getConditions } from '../../aggregator/index.js';

export const getRiskAssessmentTool = {
  description:
    'Overall risk score and breakdown for a coordinate (weather, seismic, fire layers)',
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

    return {
      location: data.location,
      timestampUtc: data.timestampUtc,
      risk: data.risk,
      confidence: data.confidence,
      sourcesQueried: data.sourcesQueried,
      sourcesFailed: data.sourcesFailed,
    };
  },
};
