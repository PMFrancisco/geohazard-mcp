import type {
  ConfidenceLevel,
  ConfidenceScore,
  Coordinates,
  SourceResult,
} from '../types/index.js';

const SOURCE_MAX_AGE_MINUTES: Record<string, number> = {
  'usgs-earthquake': 5,
  'nasa-firms': 180,
  'open-meteo': 60,
  openaq: 60,
  'open-meteo-aq': 60,
  'noaa-nws': 30,
  'noaa-swpc': 30,
  glofas: 360,
  'smithsonian-gvp': 1440,
  'noaa-tsunami': 15,
  marine: 720,
};

function getFreshnessScore(result: SourceResult<unknown>): number {
  if (!result.ok) return 0;
  const maxAgeMin = SOURCE_MAX_AGE_MINUTES[result.sourceId] ?? 60;
  const ageMin = (Date.now() - result.fetchedAt.getTime()) / 60000;

  if (ageMin <= maxAgeMin) return 1.0 - 0.7 * (ageMin / maxAgeMin);
  const overRatio = (ageMin - maxAgeMin) / maxAgeMin;
  return Math.max(0, 0.3 - 0.3 * overRatio);
}

// Fixed factor based on physical station density in the region
function getGeoFactor(coords: Coordinates): number {
  const { lat, lon } = coords;
  const absLat = Math.abs(lat);

  // Open oceans / Polar regions
  if (absLat > 66) return 0.5;

  // North America
  if (lat >= 25 && lat <= 50 && lon >= -130 && lon <= -60) return 1.0;
  // Western Europe
  if (lat >= 35 && lat <= 60 && lon >= -10 && lon <= 30) return 1.0;
  // Japan
  if (lat >= 30 && lat <= 46 && lon >= 129 && lon <= 146) return 0.9;
  // Australia
  if (lat >= -44 && lat <= -10 && lon >= 112 && lon <= 154) return 0.9;
  // South Korea
  if (lat >= 33 && lat <= 39 && lon >= 124 && lon <= 130) return 0.9;
  // Coastal South America
  if (lat >= -56 && lat <= 12 && lon >= -82 && lon <= -34) return 0.75;
  // Middle East / North Africa
  if (lat >= 15 && lat <= 40 && lon >= -17 && lon <= 60) return 0.7;
  // Central Asia
  if (lat >= 30 && lat <= 55 && lon >= 60 && lon <= 90) return 0.65;
  // Sub-Saharan Africa
  if (lat >= -35 && lat <= 15 && lon >= -17 && lon <= 52) return 0.55;

  // Default / open ocean
  return 0.5;
}

function getLevel(overall: number): {
  level: ConfidenceLevel;
  label: string;
} {
  if (overall >= 0.85) return { level: 'reliable', label: 'Reliable data' };
  if (overall >= 0.65) return { level: 'partial', label: 'Partial data' };
  if (overall >= 0.4) return { level: 'limited', label: 'Limited coverage' };
  return { level: 'estimate', label: 'Rough estimate' };
}

export function calculateConfidence(
  results: SourceResult<unknown>[],
  coords: Coordinates,
): ConfidenceScore {
  const total = results.length;
  const okCount = results.filter((r) => r.ok).length;
  const sourceRatio = total > 0 ? okCount / total : 0;

  const freshnessScores = results.map((r) => ({
    sourceId: r.sourceId,
    fresh: getFreshnessScore(r),
    ok: r.ok,
  }));

  const freshValues = freshnessScores.filter((f) => f.ok).map((f) => f.fresh);
  const freshnessAvg =
    freshValues.length > 0
      ? freshValues.reduce((a, b) => a + b, 0) / freshValues.length
      : 0;

  const geoFactor = getGeoFactor(coords);
  const overall = sourceRatio * freshnessAvg * geoFactor;
  const { level, label } = getLevel(overall);

  const sourceDetails: Record<string, { fresh: number; ok: boolean }> = {};
  for (const f of freshnessScores) {
    sourceDetails[f.sourceId] = { fresh: f.fresh, ok: f.ok };
  }

  return {
    overall: Math.round(overall * 1000) / 1000,
    level,
    label,
    factors: {
      sourceRatio: Math.round(sourceRatio * 1000) / 1000,
      freshnessAvg: Math.round(freshnessAvg * 1000) / 1000,
      geoFactor,
    },
    sourceDetails,
  };
}
