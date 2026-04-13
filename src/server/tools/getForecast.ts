import { z } from 'zod';
import { getEnsembleForecast } from '../../aggregator/forecast.js';

export const getForecastTool = {
  description:
    'Multi-hazard forecast with per-day risk score and confidence bands (weather, air quality, flood, space weather)',
  schema: z.object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
    days: z.number().int().min(1).max(16).default(7),
  }),
  handler: async ({
    lat,
    lon,
    days,
  }: {
    lat: number;
    lon: number;
    days?: number;
  }) => {
    return getEnsembleForecast({ lat, lon, days: days ?? 7 });
  },
};
