import type {
  AggregatedConditions,
  AirQualityData,
  AggregatorOptions,
  Coordinates,
  RiskAssessment,
  SourceResult,
} from '../types/index.js';
import { fetchOpenMeteo } from './openMeteo.js';
import { fetchUSGSEarthquake } from './usgsEarthquake.js';
import { fetchNASAFirms } from './nasaFirms.js';
import { fetchOpenAQ } from './openAQ.js';
import { fetchOpenMeteoAq } from './openMeteoAq.js';
import { fetchNoaaNws } from './noaaNws.js';
import { fetchNoaaSwpc } from './noaaSwpc.js';
import { fetchGlofas } from './glofas.js';
import { fetchSmithsonianGvp } from './smithsonianGvp.js';
import { fetchNoaaTsunami } from './noaaTsunami.js';
import { fetchCmems } from './cmems.js';
import { fetchGdacs } from './gdacs.js';
import {
  scoreWeather,
  scoreSeismic,
  scoreFire,
  scoreFlood,
  scoreSpaceWeather,
  scoreVolcanic,
  scoreCyclone,
  scoreAirQuality,
} from '../aggregator/riskScore.js';

export type RiskLayer = keyof NonNullable<RiskAssessment['layerScores']>;

type DirectKeys = Exclude<
  keyof AggregatedConditions,
  | 'location'
  | 'timestampUtc'
  | 'sourcesQueried'
  | 'sourcesFailed'
  | 'confidence'
  | 'risk'
  | 'airQuality'
>;

export type RiskHook<T> = {
  layer: RiskLayer;
  weight: number;
  score: (data: T) => number;
  factorLabel?: string;
};

export type DirectSource<K extends DirectKeys = DirectKeys> = {
  kind: 'direct';
  id: string;
  key: K;
  fetch: (
    coords: Coordinates,
    opts: AggregatorOptions,
  ) => Promise<SourceResult<NonNullable<AggregatedConditions[K]>>>;
  freshnessMinutes: number;
  risk?: RiskHook<NonNullable<AggregatedConditions[K]>>;
  apply: (
    c: Partial<AggregatedConditions>,
    r: SourceResult<NonNullable<AggregatedConditions[K]>>,
  ) => void;
};

export type MergedSource = {
  kind: 'merged';
  id: string;
  group: 'airQuality';
  fetch: (
    coords: Coordinates,
    opts: AggregatorOptions,
  ) => Promise<SourceResult<AirQualityData>>;
  freshnessMinutes: number;
};

type AnyDirectSource = { [K in DirectKeys]: DirectSource<K> }[DirectKeys];
export type SourceDefinition = AnyDirectSource | MergedSource;

function direct<K extends DirectKeys>(
  entry: Omit<DirectSource<K>, 'kind' | 'apply'>,
): DirectSource<K> {
  return {
    ...entry,
    kind: 'direct',
    apply: (c, r) => {
      c[entry.key] = (r.ok ? r.data : null) as AggregatedConditions[K];
    },
  };
}

export const SOURCES: readonly SourceDefinition[] = [
  direct({
    id: 'open-meteo',
    key: 'weather',
    fetch: fetchOpenMeteo,
    freshnessMinutes: 60,
    risk: { layer: 'weather', weight: 0.2, score: scoreWeather },
  }),
  direct({
    id: 'usgs-earthquake',
    key: 'seismic',
    fetch: (coords, opts) => fetchUSGSEarthquake(coords, opts.radiusKm ?? 500),
    freshnessMinutes: 5,
    risk: { layer: 'seismic', weight: 0.25, score: scoreSeismic },
  }),
  direct({
    id: 'nasa-firms',
    key: 'fire',
    fetch: (coords, opts) => fetchNASAFirms(coords, opts.firmsKey),
    freshnessMinutes: 180,
    risk: { layer: 'fire', weight: 0.2, score: scoreFire },
  }),
  {
    kind: 'merged',
    id: 'openaq',
    group: 'airQuality',
    fetch: fetchOpenAQ,
    freshnessMinutes: 60,
  },
  {
    kind: 'merged',
    id: 'open-meteo-aq',
    group: 'airQuality',
    fetch: fetchOpenMeteoAq,
    freshnessMinutes: 60,
  },
  direct({
    id: 'noaa-nws',
    key: 'nwsAlerts',
    fetch: fetchNoaaNws,
    freshnessMinutes: 30,
  }),
  direct({
    id: 'noaa-swpc',
    key: 'spaceWeather',
    fetch: fetchNoaaSwpc,
    freshnessMinutes: 30,
    risk: { layer: 'space', weight: 0.05, score: scoreSpaceWeather },
  }),
  direct({
    id: 'glofas',
    key: 'flood',
    fetch: fetchGlofas,
    freshnessMinutes: 360,
    risk: { layer: 'flood', weight: 0.15, score: scoreFlood },
  }),
  direct({
    id: 'smithsonian-gvp',
    key: 'volcanic',
    fetch: fetchSmithsonianGvp,
    freshnessMinutes: 1440,
    risk: { layer: 'volcanic', weight: 0.05, score: scoreVolcanic },
  }),
  direct({
    id: 'noaa-tsunami',
    key: 'tsunami',
    fetch: fetchNoaaTsunami,
    freshnessMinutes: 15,
  }),
  direct({
    id: 'marine',
    key: 'marine',
    fetch: fetchCmems,
    freshnessMinutes: 720,
  }),
  direct({
    id: 'gdacs',
    key: 'gdacs',
    fetch: fetchGdacs,
    freshnessMinutes: 10,
    risk: {
      layer: 'weather',
      weight: 0.2,
      score: scoreCyclone,
      factorLabel: 'cyclone',
    },
  }),
];

export const MERGED_RISK: { airQuality: RiskHook<AirQualityData> } = {
  airQuality: { layer: 'airQuality', weight: 0.1, score: scoreAirQuality },
};

// Module-load invariants: catches registry regressions without a test framework.
if (new Set(SOURCES.map((s) => s.id)).size !== SOURCES.length) {
  throw new Error('Duplicate source id in SOURCES registry');
}
{
  const layerWeight = new Map<RiskLayer, number>();
  for (const s of SOURCES) {
    if (s.kind !== 'direct' || !s.risk) continue;
    const prev = layerWeight.get(s.risk.layer);
    if (prev != null && prev !== s.risk.weight) {
      throw new Error(
        `Layer weight mismatch on '${s.risk.layer}': ${prev} vs ${s.risk.weight}`,
      );
    }
    layerWeight.set(s.risk.layer, s.risk.weight);
  }
}
