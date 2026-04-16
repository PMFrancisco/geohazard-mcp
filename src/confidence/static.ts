import type {
  ConfidenceLevel,
  ConfidenceScore,
  Coordinates,
  SourceResult,
} from '../types/index.js';
import { SOURCES } from '../sources/registry.js';

/**
 * Multiplier on a source's declared `freshnessMinutes` beyond which its result
 * is considered stale and counted as a failure.
 */
const STALE_MULTIPLIER = 2;

function getLevel(overall: number): {
  level: ConfidenceLevel;
  label: string;
} {
  if (overall >= 0.8) return { level: 'reliable', label: 'Reliable data' };
  if (overall >= 0.6) return { level: 'partial', label: 'Partial data' };
  if (overall >= 0.4) return { level: 'limited', label: 'Limited coverage' };
  return { level: 'estimate', label: 'Rough estimate' };
}

/**
 * Confidence = fraction of location-applicable sources that returned fresh ok data.
 *
 *   overall = okCount / applicableCount
 *
 * Sources that don't apply to the query location (e.g., NOAA NWS outside the US)
 * are excluded from both numerator and denominator so geography doesn't penalise
 * the score. A source is "ok" only if `ok === true` AND its data is not stale
 * (age ≤ `STALE_MULTIPLIER × freshnessMinutes`).
 */
export function calculateConfidence(
  results: SourceResult<unknown>[],
  coords: Coordinates,
): ConfidenceScore {
  const freshnessById = new Map<string, number>();
  const applicabilityById = new Map<string, boolean>();
  for (const s of SOURCES) {
    freshnessById.set(s.id, s.freshnessMinutes);
    applicabilityById.set(s.id, s.appliesTo(coords));
  }

  const applicableSources: string[] = [];
  const okSources: string[] = [];
  const failedSources: string[] = [];
  const notApplicableSources: string[] = [];

  const now = Date.now();
  for (const r of results) {
    const applies = applicabilityById.get(r.sourceId) ?? true;
    if (!applies) {
      notApplicableSources.push(r.sourceId);
      continue;
    }
    applicableSources.push(r.sourceId);

    if (!r.ok) {
      failedSources.push(r.sourceId);
      continue;
    }

    const maxAgeMin = freshnessById.get(r.sourceId) ?? 60;
    const ageMin = (now - r.fetchedAt.getTime()) / 60000;
    if (ageMin > STALE_MULTIPLIER * maxAgeMin) {
      failedSources.push(r.sourceId);
      continue;
    }

    okSources.push(r.sourceId);
  }

  const applicableCount = applicableSources.length;
  if (applicableCount === 0) {
    return {
      overall: 0,
      level: 'estimate',
      label: 'Rough estimate',
      applicableSources,
      okSources,
      failedSources,
      notApplicableSources,
    };
  }

  const overall = okSources.length / applicableCount;
  const { level, label } = getLevel(overall);

  return {
    overall: Math.round(overall * 1000) / 1000,
    level,
    label,
    applicableSources,
    okSources,
    failedSources,
    notApplicableSources,
  };
}
