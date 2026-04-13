import { z } from 'zod';
import { compareSources } from '../../aggregator/compareSources.js';

export const compareSourcesTool = {
  description:
    'Raw per-source data + detected discrepancies (>5% delta) for auditing and ML seed data',
  schema: z.object({
    lat: z.number().min(-90).max(90),
    lon: z.number().min(-180).max(180),
  }),
  handler: async ({ lat, lon }: { lat: number; lon: number }) => {
    return compareSources({ lat, lon });
  },
};
