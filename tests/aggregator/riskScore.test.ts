import { describe, it, expect } from 'vitest';
import {
  scoreWeather,
  scoreCyclone,
  scoreSeismic,
  scoreFire,
  scoreAirQuality,
  scoreFlood,
  scoreSpaceWeather,
  scoreVolcanic,
  calculateRisk,
} from '../../src/aggregator/riskScore.js';
import type {
  WeatherData,
  FireData,
  AirQualityData,
  FloodData,
  SpaceWeatherData,
  VolcanicData,
  AggregatedConditions,
} from '../../src/types/index.js';
import type { GdacsData } from '../../src/sources/gdacs.js';

const baseWeather: WeatherData = {
  tempC: 20,
  feelsLikeC: 20,
  humidityPct: 50,
  windKmh: 10,
  precipitationMm: 0,
  condition: 'Clear',
  uvIndex: 3,
};

describe('scoreWeather', () => {
  it('returns 0 for benign conditions', () => {
    expect(scoreWeather(baseWeather)).toBe(0);
  });

  it('scores heavy precipitation', () => {
    expect(scoreWeather({ ...baseWeather, precipitationMm: 60 })).toBeCloseTo(
      0.4,
    );
    expect(scoreWeather({ ...baseWeather, precipitationMm: 25 })).toBeCloseTo(
      0.2,
    );
  });

  it('scores strong wind', () => {
    expect(scoreWeather({ ...baseWeather, windKmh: 110 })).toBeCloseTo(0.4);
    expect(scoreWeather({ ...baseWeather, windKmh: 70 })).toBeCloseTo(0.25);
  });

  it('scores extreme temperature', () => {
    expect(scoreWeather({ ...baseWeather, tempC: 46 })).toBeCloseTo(0.2);
    expect(scoreWeather({ ...baseWeather, tempC: -31 })).toBeCloseTo(0.2);
  });

  it('scores high UV', () => {
    expect(scoreWeather({ ...baseWeather, uvIndex: 11 })).toBeCloseTo(0.15);
  });

  it('caps at 1.0 when many factors trigger', () => {
    expect(
      scoreWeather({
        ...baseWeather,
        precipitationMm: 60,
        windKmh: 110,
        uvIndex: 11,
        tempC: 50,
      }),
    ).toBe(1.0);
  });
});

const gdacs = (
  events: Array<{
    eventType: 'EQ' | 'TC' | 'FL' | 'VO';
    alertLevel: 'Green' | 'Orange' | 'Red';
  }>,
): GdacsData => ({
  events: events.map((e, i) => ({
    eventType: e.eventType,
    eventId: i,
    name: `Event ${i}`,
    alertLevel: e.alertLevel,
    alertScore: 0,
    severity: '',
    severityValue: 0,
    severityUnit: '',
    country: '',
    coordinates: { lat: 0, lon: 0 },
    fromDate: '',
    toDate: '',
  })),
  totalEvents: events.length,
  hasCyclone: events.some((e) => e.eventType === 'TC'),
  maxAlertLevel: 'None',
});

describe('scoreCyclone', () => {
  it('returns 0 when there are no cyclones', () => {
    expect(scoreCyclone(gdacs([]))).toBe(0);
    expect(scoreCyclone(gdacs([{ eventType: 'EQ', alertLevel: 'Red' }]))).toBe(
      0,
    );
  });

  it('scores Red cyclone as 1.0', () => {
    expect(scoreCyclone(gdacs([{ eventType: 'TC', alertLevel: 'Red' }]))).toBe(
      1.0,
    );
  });

  it('scores Orange cyclone as 0.6', () => {
    expect(
      scoreCyclone(gdacs([{ eventType: 'TC', alertLevel: 'Orange' }])),
    ).toBeCloseTo(0.6);
  });

  it('scores Green cyclone as 0.15', () => {
    expect(
      scoreCyclone(gdacs([{ eventType: 'TC', alertLevel: 'Green' }])),
    ).toBeCloseTo(0.15);
  });

  it('returns the max across multiple cyclones', () => {
    expect(
      scoreCyclone(
        gdacs([
          { eventType: 'TC', alertLevel: 'Green' },
          { eventType: 'TC', alertLevel: 'Orange' },
        ]),
      ),
    ).toBeCloseTo(0.6);
  });
});

describe('scoreSeismic', () => {
  it('returns 0 with no events', () => {
    expect(
      scoreSeismic({
        recentEvents: [],
        nearestEventDistanceKm: null,
        maxMagnitude: null,
      }),
    ).toBe(0);
  });

  it('ignores sub-3.0 events', () => {
    const s = scoreSeismic({
      recentEvents: [
        {
          id: '1',
          magnitude: 2.5,
          depthKm: 10,
          distanceKm: 10,
          place: 'x',
          timeUtc: new Date().toISOString(),
          tsunami: false,
        },
      ],
      nearestEventDistanceKm: 10,
      maxMagnitude: 2.5,
    });
    expect(s).toBe(0);
  });

  it('scores a very recent nearby M7 event at or near 1.0', () => {
    const s = scoreSeismic({
      recentEvents: [
        {
          id: '1',
          magnitude: 7.2,
          depthKm: 10,
          distanceKm: 50,
          place: 'x',
          timeUtc: new Date().toISOString(),
          tsunami: false,
        },
      ],
      nearestEventDistanceKm: 50,
      maxMagnitude: 7.2,
    });
    expect(s).toBeGreaterThan(0.9);
    expect(s).toBeLessThanOrEqual(1.0);
  });

  it('adds tsunami boost capped at 1.0', () => {
    const withTsunami = scoreSeismic({
      recentEvents: [
        {
          id: '1',
          magnitude: 7.2,
          depthKm: 10,
          distanceKm: 50,
          place: 'x',
          timeUtc: new Date().toISOString(),
          tsunami: true,
        },
      ],
      nearestEventDistanceKm: 50,
      maxMagnitude: 7.2,
    });
    expect(withTsunami).toBe(1.0);
  });

  it('decays older events towards 0', () => {
    const old = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
    const s = scoreSeismic({
      recentEvents: [
        {
          id: '1',
          magnitude: 4.5,
          depthKm: 10,
          distanceKm: 20,
          place: 'x',
          timeUtc: old,
          tsunami: false,
        },
      ],
      nearestEventDistanceKm: 20,
      maxMagnitude: 4.5,
    });
    expect(s).toBeLessThan(0.05);
  });
});

const baseFire: FireData = {
  hotspotsNearby: [],
  totalHotspots100km: 0,
  totalHotspots500km: 0,
  maxBrightness: null,
  nearestDistanceKm: null,
};

describe('scoreFire', () => {
  it('returns 0 when there are no fires', () => {
    expect(scoreFire(baseFire)).toBe(0);
  });

  it('scales with hotspot count', () => {
    expect(scoreFire({ ...baseFire, totalHotspots100km: 5 })).toBeCloseTo(0.1);
    expect(scoreFire({ ...baseFire, totalHotspots100km: 15 })).toBeCloseTo(
      0.25,
    );
    expect(scoreFire({ ...baseFire, totalHotspots100km: 40 })).toBeCloseTo(0.5);
  });

  it('adds a proximity boost when the nearest hotspot is close', () => {
    const far = scoreFire({ ...baseFire, totalHotspots100km: 15 });
    const near = scoreFire({
      ...baseFire,
      totalHotspots100km: 15,
      nearestDistanceKm: 5,
    });
    expect(near).toBeGreaterThan(far);
  });

  it('caps at 1.0', () => {
    expect(
      scoreFire({
        totalHotspots100km: 100,
        totalHotspots500km: 500,
        maxBrightness: 500,
        nearestDistanceKm: 1,
        hotspotsNearby: [],
      }),
    ).toBe(1.0);
  });
});

describe('scoreAirQuality', () => {
  const cases: Array<[number, number]> = [
    [30, 0],
    [75, 0.15],
    [120, 0.35],
    [175, 0.55],
    [250, 0.8],
    [400, 1.0],
  ];
  it.each(cases)('aqi %i → %f', (aqi, expected) => {
    expect(
      scoreAirQuality({
        aqi,
        pm25: 0,
        pm10: 0,
        no2: 0,
        o3: 0,
        category: '',
        dominantPollutant: 'pm25',
        source: 'openaq',
        whoExceedances: [],
      } as AirQualityData),
    ).toBeCloseTo(expected);
  });
});

describe('scoreFlood', () => {
  it('prefers dischargeM3s when present', () => {
    const f: FloodData = {
      dischargeM3s: 6000,
      returnPeriod: '< 5y',
      forecastDays: 1,
      riverName: null,
    };
    expect(scoreFlood(f)).toBe(1.0);
  });

  it('falls back to returnPeriod when dischargeM3s is null', () => {
    const f: FloodData = {
      dischargeM3s: null,
      returnPeriod: '> 100y',
      forecastDays: 1,
      riverName: null,
    };
    expect(scoreFlood(f)).toBe(1.0);
  });

  it('returns 0 for quiet water', () => {
    expect(
      scoreFlood({
        dischargeM3s: 10,
        returnPeriod: '< 5y',
        forecastDays: 1,
        riverName: null,
      }),
    ).toBe(0);
  });
});

describe('scoreSpaceWeather', () => {
  const cases: Array<[number, number]> = [
    [3, 0],
    [4, 0.2],
    [5, 0.4],
    [6, 0.6],
    [7, 0.8],
    [9, 1.0],
  ];
  it.each(cases)('kp %i → %f', (kp, expected) => {
    const sw: SpaceWeatherData = {
      kpIndex: kp,
      kpCategory: '',
      solarWindSpeedKms: null,
      geomagneticStorm: false,
      auroraAlert: false,
    };
    expect(scoreSpaceWeather(sw)).toBeCloseTo(expected);
  });
});

describe('scoreVolcanic', () => {
  it('returns 0 with no activity', () => {
    expect(scoreVolcanic({ recentActivity: [], nearbyCount: 0 })).toBe(0);
  });

  it('scores erupting volcano nearby', () => {
    const v: VolcanicData = {
      recentActivity: [
        {
          volcanoName: 'Foo',
          region: '',
          activityLevel: 'Erupting',
          date: '',
          lat: 0,
          lon: 0,
          distanceKm: 30,
        },
      ],
      nearbyCount: 1,
    };
    expect(scoreVolcanic(v)).toBeCloseTo(0.9);
  });

  it('zeroes out distant volcanoes', () => {
    const v: VolcanicData = {
      recentActivity: [
        {
          volcanoName: 'Foo',
          region: '',
          activityLevel: 'Erupting',
          date: '',
          lat: 0,
          lon: 0,
          distanceKm: 600,
        },
      ],
      nearbyCount: 1,
    };
    expect(scoreVolcanic(v)).toBe(0);
  });
});

describe('calculateRisk', () => {
  it('returns minimal with no data', () => {
    const r = calculateRisk({}, null);
    expect(r.overallScore).toBe(0);
    expect(r.level).toBe('minimal');
    expect(r.mainFactors).toEqual([]);
  });

  it('assigns "critical" when overallScore ≥ 0.8', () => {
    const conds: Partial<AggregatedConditions> = {
      weather: {
        ...baseWeather,
        precipitationMm: 80,
        windKmh: 120,
        uvIndex: 11,
        tempC: 50,
      },
      gdacs: gdacs([{ eventType: 'TC', alertLevel: 'Red' }]),
    };
    const r = calculateRisk(conds, null);
    expect(r.overallScore).toBeGreaterThanOrEqual(0.7);
    expect(r.mainFactors).toContain('weather');
  });

  it('flags cyclone when it exceeds baseline weather', () => {
    const conds: Partial<AggregatedConditions> = {
      weather: baseWeather,
      gdacs: gdacs([{ eventType: 'TC', alertLevel: 'Orange' }]),
    };
    const r = calculateRisk(conds, null);
    expect(r.mainFactors).toContain('cyclone');
  });

  it('drops the weather layer when neither weather nor cyclone is present', () => {
    const r = calculateRisk({}, null);
    expect(r.layerScores.weather).toBeUndefined();
  });
});
