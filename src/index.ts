import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { getConditions } from './aggregator/index.js';

export * from './types/index.js';
export { getConditions } from './aggregator/index.js';

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const madrid = { lat: 40.41, lon: -3.7 };
  getConditions(madrid).then((r) => console.log(JSON.stringify(r, null, 2)));
}
