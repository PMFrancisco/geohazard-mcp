import type { Coordinates, SourceResult, TsunamiData } from '../types/index.js';

/**
 * NOAA Tsunami Warning Center — active tsunami advisories.
 * Parses the CAP/Atom feed from tsunami.gov.
 * No API key required.
 */
export async function fetchNoaaTsunami(
  _coords: Coordinates,
): Promise<SourceResult<TsunamiData>> {
  const startTime = Date.now();
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 5000);

  try {
    const url = 'https://www.tsunami.gov/events/xml/PAAQAtom.xml';
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'planetary-risk/1.0' },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const xml = await res.text();
    const warnings = parseTsunamiXml(xml);

    return {
      sourceId: 'noaa-tsunami',
      ok: true,
      fetchedAt: new Date(),
      data: {
        activeWarnings: warnings,
        hasActiveWarning: warnings.length > 0,
      },
      latencyMs: Date.now() - startTime,
    };
  } catch (err) {
    return {
      sourceId: 'noaa-tsunami',
      ok: false,
      fetchedAt: new Date(),
      data: null,
      error: String(err),
      latencyMs: Date.now() - startTime,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function parseTsunamiXml(xml: string): TsunamiData['activeWarnings'] {
  const warnings: TsunamiData['activeWarnings'] = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/gi;
  let match: RegExpExecArray | null;

  while ((match = entryRegex.exec(xml)) !== null) {
    const block = match[1];
    const id = extractTag(block, 'id') || '';
    const title = extractTag(block, 'title') || '';
    const updated = extractTag(block, 'updated') || '';
    const summary = extractTag(block, 'summary') || '';

    // Skip "no active" messages
    const lower = title.toLowerCase();
    if (lower.includes('no active') || lower.includes('this is a test'))
      continue;

    // Determine severity from title
    let severity = 'Information';
    if (lower.includes('warning')) severity = 'Warning';
    else if (lower.includes('watch')) severity = 'Watch';
    else if (lower.includes('advisory')) severity = 'Advisory';

    warnings.push({
      id,
      severity,
      area: title,
      issuedAt: updated,
      description: summary.slice(0, 500),
    });
  }

  return warnings;
}

function extractTag(xml: string, tag: string): string | null {
  const regex = new RegExp(
    `<${tag}[^>]*>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?</${tag}>`,
    'is',
  );
  const m = regex.exec(xml);
  return m ? m[1].trim() : null;
}
