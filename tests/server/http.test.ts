import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { AggregatedConditions } from '../../src/types/index.js';

// Aggregator modules are stubbed — tier 3 tests the server layer, not the
// business logic already covered by tiers 1 and 2.
vi.mock('../../src/aggregator/index.js', () => ({
  getConditions: vi.fn(),
  fetchAllSources: vi.fn(),
}));
vi.mock('../../src/aggregator/forecast.js', () => ({
  getEnsembleForecast: vi.fn(),
}));
vi.mock('../../src/aggregator/compareSources.js', () => ({
  compareSources: vi.fn(),
  detectDiscrepancies: vi.fn(),
}));

import { getConditions } from '../../src/aggregator/index.js';
import { getEnsembleForecast } from '../../src/aggregator/forecast.js';
import { compareSources } from '../../src/aggregator/compareSources.js';
import { buildHttpApp } from '../../src/server/http.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

const mockedGetConditions = vi.mocked(getConditions);
const mockedForecast = vi.mocked(getEnsembleForecast);
const mockedCompareSources = vi.mocked(compareSources);

const fakeConditions: AggregatedConditions = {
  location: { lat: 40, lon: -3 },
  timestampUtc: '2026-04-16T12:00:00Z',
  sourcesQueried: ['open-meteo'],
  sourcesFailed: [],
  weather: {
    tempC: 20,
    feelsLikeC: 20,
    humidityPct: 50,
    windKmh: 10,
    precipitationMm: 0,
    condition: 'Clear',
    uvIndex: 3,
  },
  seismic: null,
  fire: null,
  airQuality: null,
  flood: null,
  spaceWeather: null,
  volcanic: null,
  tsunami: null,
  nwsAlerts: null,
  marine: null,
  gdacs: null,
  confidence: {
    overall: 1,
    level: 'reliable',
    label: 'Reliable data',
    applicableSources: ['open-meteo'],
    okSources: ['open-meteo'],
    failedSources: [],
    notApplicableSources: [],
  },
  risk: {
    overallScore: 0.1,
    level: 'minimal',
    mainFactors: [],
    layerScores: {},
  },
  discrepancies: [],
};

let app: Express;

beforeAll(() => {
  const server = new McpServer({ name: 'test', version: '0.0.0' });
  app = buildHttpApp(server);
});

beforeEach(() => {
  mockedGetConditions.mockResolvedValue(fakeConditions);
  mockedForecast.mockResolvedValue({
    location: { lat: 40, lon: -3 },
    current: fakeConditions,
    days: [],
    models: [],
    sources: [],
    generatedAt: '2026-04-16T12:00:00Z',
  });
  mockedCompareSources.mockResolvedValue({
    location: { lat: 40, lon: -3 },
    timestampUtc: '2026-04-16T12:00:00Z',
    sources: {},
    discrepancies: [],
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('GET /health', () => {
  it('returns ok with the full tool list', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.tools).toEqual(
      expect.arrayContaining([
        'get_conditions',
        'get_alerts',
        'get_risk_assessment',
        'get_forecast',
        'compare_sources',
      ]),
    );
  });
});

describe('POST /tools/:name — routing', () => {
  it('404s on an unknown tool', async () => {
    const res = await request(app)
      .post('/tools/does_not_exist')
      .send({ lat: 40, lon: -3 });
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/unknown tool/);
  });

  it('400s when input fails schema validation', async () => {
    const res = await request(app)
      .post('/tools/get_conditions')
      .send({ lat: 999, lon: -3 });
    expect(res.status).toBe(400);
    expect(Array.isArray(res.body.error)).toBe(true);
  });

  it('500s when the handler throws', async () => {
    mockedGetConditions.mockRejectedValueOnce(new Error('upstream down'));
    const res = await request(app)
      .post('/tools/get_conditions')
      .send({ lat: 40, lon: -3 });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/upstream down/);
  });
});

describe('POST /tools/get_conditions', () => {
  it('returns the aggregated snapshot on valid input', async () => {
    const res = await request(app)
      .post('/tools/get_conditions')
      .send({ lat: 40, lon: -3 });
    expect(res.status).toBe(200);
    expect(res.body.location).toEqual({ lat: 40, lon: -3 });
    expect(res.body.weather.tempC).toBe(20);
    expect(mockedGetConditions).toHaveBeenCalledWith(
      { lat: 40, lon: -3 },
      { radiusKm: 500 },
    );
  });

  it('forwards a custom radius_km', async () => {
    await request(app)
      .post('/tools/get_conditions')
      .send({ lat: 0, lon: 0, radius_km: 100 });
    expect(mockedGetConditions).toHaveBeenCalledWith(
      { lat: 0, lon: 0 },
      { radiusKm: 100 },
    );
  });
});

describe('POST /tools/get_alerts', () => {
  it('derives alerts from conditions', async () => {
    mockedGetConditions.mockResolvedValueOnce({
      ...fakeConditions,
      weather: {
        ...fakeConditions.weather!,
        windKmh: 130,
        precipitationMm: 60,
      },
    });
    const res = await request(app)
      .post('/tools/get_alerts')
      .send({ lat: 40, lon: -3 });
    expect(res.status).toBe(200);
    expect(res.body.alertCount).toBeGreaterThan(0);
    const types = res.body.alerts.map((a: { type: string }) => a.type);
    expect(types).toContain('weather');
  });

  it('returns an empty alert list when conditions are calm', async () => {
    const res = await request(app)
      .post('/tools/get_alerts')
      .send({ lat: 40, lon: -3 });
    expect(res.status).toBe(200);
    expect(res.body.alertCount).toBe(0);
    expect(res.body.alerts).toEqual([]);
  });
});

describe('POST /tools/get_risk_assessment', () => {
  it('returns the risk + confidence from conditions', async () => {
    const res = await request(app)
      .post('/tools/get_risk_assessment')
      .send({ lat: 40, lon: -3 });
    expect(res.status).toBe(200);
    expect(res.body.risk.level).toBe('minimal');
    expect(res.body.confidence.level).toBe('reliable');
    expect(res.body).not.toHaveProperty('weather'); // trimmed view
  });
});

describe('POST /tools/get_forecast', () => {
  it('calls the forecast aggregator with the requested days', async () => {
    const res = await request(app)
      .post('/tools/get_forecast')
      .send({ lat: 40, lon: -3, days: 3 });
    expect(res.status).toBe(200);
    expect(mockedForecast).toHaveBeenCalledWith({
      lat: 40,
      lon: -3,
      days: 3,
    });
    expect(res.body.generatedAt).toBeDefined();
  });

  it('defaults days to 7 when omitted', async () => {
    await request(app).post('/tools/get_forecast').send({ lat: 40, lon: -3 });
    expect(mockedForecast).toHaveBeenCalledWith({
      lat: 40,
      lon: -3,
      days: 7,
    });
  });

  it('400s when days is outside [1, 16]', async () => {
    const res = await request(app)
      .post('/tools/get_forecast')
      .send({ lat: 40, lon: -3, days: 99 });
    expect(res.status).toBe(400);
  });
});

describe('POST /tools/compare_sources', () => {
  it('returns the per-source comparison payload', async () => {
    const res = await request(app)
      .post('/tools/compare_sources')
      .send({ lat: 40, lon: -3 });
    expect(res.status).toBe(200);
    expect(mockedCompareSources).toHaveBeenCalledWith({ lat: 40, lon: -3 });
    expect(res.body.discrepancies).toEqual([]);
  });
});
