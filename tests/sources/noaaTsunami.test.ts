import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchNoaaTsunami } from '../../src/sources/noaaTsunami.js';
import { stubFetchOnce, stubFetchStatus } from './_helpers.js';

afterEach(() => vi.unstubAllGlobals());

const warningXml = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>urn:oid:1</id>
    <title>Tsunami Warning for Alaska</title>
    <updated>2026-04-16T10:00:00Z</updated>
    <summary>Large earthquake — evacuate coastal zones</summary>
  </entry>
  <entry>
    <id>urn:oid:2</id>
    <title>Tsunami Advisory for Hawaii</title>
    <updated>2026-04-16T11:00:00Z</updated>
    <summary>Minor wave activity expected</summary>
  </entry>
  <entry>
    <id>urn:oid:3</id>
    <title>No active tsunami warnings</title>
    <updated>2026-04-16T12:00:00Z</updated>
    <summary>None in effect</summary>
  </entry>
</feed>`;

describe('fetchNoaaTsunami', () => {
  it('parses warnings and infers severity from the title', async () => {
    stubFetchOnce(warningXml);

    const r = await fetchNoaaTsunami({ lat: 60, lon: -150 });
    expect(r.ok).toBe(true);
    expect(r.data!.hasActiveWarning).toBe(true);
    expect(r.data!.activeWarnings).toHaveLength(2);
    expect(r.data!.activeWarnings[0].severity).toBe('Warning');
    expect(r.data!.activeWarnings[1].severity).toBe('Advisory');
  });

  it('reports no active warnings when the feed is empty / noise only', async () => {
    stubFetchOnce(`<feed>
      <entry>
        <id>urn:oid:x</id>
        <title>This is a test</title>
        <updated>2026-04-16T10:00:00Z</updated>
        <summary>Test only</summary>
      </entry>
    </feed>`);
    const r = await fetchNoaaTsunami({ lat: 0, lon: 0 });
    expect(r.ok).toBe(true);
    expect(r.data!.hasActiveWarning).toBe(false);
    expect(r.data!.activeWarnings).toEqual([]);
  });

  it('returns ok=false on HTTP error', async () => {
    stubFetchStatus(500);
    const r = await fetchNoaaTsunami({ lat: 0, lon: 0 });
    expect(r.ok).toBe(false);
  });
});
