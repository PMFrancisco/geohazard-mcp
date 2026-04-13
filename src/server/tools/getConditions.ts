import { z } from 'zod';
import { getConditions } from '../../aggregator/index.js';

export const getConditionsTool = {
  description: 'Real-time environmental conditions at a coordinate',
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
    return getConditions({ lat, lon }, { radiusKm: radius_km });
  },
};
