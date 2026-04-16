# Geohazard

An open-source MCP server that aggregates real-time environmental and natural-hazard data from 12 public sources into a unified risk assessment. Point any MCP-compatible client (Claude Desktop, Cursor, your own agent) at the server and query planetary conditions by coordinate.

## Data Sources

| Source              | Layer                                                                   |
| ------------------- | ----------------------------------------------------------------------- |
| Open-Meteo          | Weather (temperature, wind, precipitation, UV)                          |
| Open-Meteo AQ       | Air quality forecasts (PM2.5, PM10, O3, NO2)                            |
| OpenAQ              | Physical air quality station measurements                               |
| USGS Earthquake     | Seismic events — 7-day lookback with Omori decay                        |
| NASA FIRMS          | Fire hotspots (density + nearest proximity, VIIRS confidence-filtered)  |
| GloFAS (Copernicus) | Flood discharge forecasts                                               |
| NOAA NWS            | Severe weather alerts (US / PR / VI / Guam only)                        |
| NOAA SWPC           | Space weather (Kp index, geomagnetic storms)                            |
| NOAA Tsunami        | Active tsunami warnings                                                 |
| Smithsonian GVP     | Volcanic activity with alert-level × proximity scoring                  |
| CMEMS (Copernicus)  | Marine conditions (SST, wave height, currents)                          |
| GDACS               | Global disaster alerts — contributes cyclone score to the weather layer |

All sources are free/public. NASA FIRMS and OpenAQ need API keys (free to register) — without them those layers are skipped. OpenAQ and Open-Meteo AQ are distance-weighted and blended into a single air quality result with pollutants normalized to the **US EPA AQI scale** so cross-source comparisons are meaningful.

Each source is wired through a central registry ([src/sources/registry.ts](src/sources/registry.ts)) that declares its fetch function, freshness window, applicability predicate, and — where relevant — its risk-scoring hook. Adding a new source is ~3 files.

## Risk Scoring

The overall risk score (0–1) is a weighted sum of per-layer scores, with two safeguards:

- **Critical override**: if any single layer scores ≥ 0.9, the overall score is at least 0.7 (high). If any layer scores ≥ 0.75, at least 0.5 (moderate). This prevents a catastrophic single-hazard event from being diluted by calm conditions elsewhere.
- **Omori seismic decay**: earthquake risk uses a modified Omori model based on actual event time rather than flat exponential decay. Large earthquakes (M6+) maintain elevated risk for days 0–3 reflecting real aftershock patterns.

Layer weights (declared in the registry):

| Layer         | Weight | Contributing source(s)           |
| ------------- | ------ | -------------------------------- |
| Seismic       | 0.25   | USGS Earthquake                  |
| Weather       | 0.20   | Open-Meteo, GDACS (cyclone)      |
| Fire          | 0.20   | NASA FIRMS                       |
| Flood         | 0.15   | GloFAS                           |
| Air quality   | 0.10   | OpenAQ + Open-Meteo AQ (blended) |
| Space weather | 0.05   | NOAA SWPC                        |
| Volcanic      | 0.05   | Smithsonian GVP                  |

| Level    | Score  |
| -------- | ------ |
| Critical | ≥ 0.80 |
| High     | ≥ 0.60 |
| Moderate | ≥ 0.35 |
| Low      | ≥ 0.15 |
| Minimal  | < 0.15 |

## Confidence Scoring

Confidence is the fraction of location-applicable sources that returned fresh, ok data:

```
overall = okCount / applicableCount
```

- **Applicability**: a source is counted only if its scope covers the query location. In practice this only excludes NOAA NWS outside the US/PR/VI/Guam (where `api.weather.gov` hard-fails with 404). Every other source is global; its own `ok` signal is trusted.
- **Staleness**: a source is counted as failed if its data is older than `2 × freshnessMinutes` (freshness windows live in the registry).
- **Shape**: [`ConfidenceScore`](src/types/index.ts) exposes `applicableSources`, `okSources`, `failedSources`, and `notApplicableSources` so clients can see exactly which sources contributed.

| Level    | Score  |
| -------- | ------ |
| Reliable | ≥ 0.80 |
| Partial  | ≥ 0.60 |
| Limited  | ≥ 0.40 |
| Estimate | < 0.40 |

### Discrepancies

Cross-source disagreements are detected separately and surfaced on `AggregatedConditions.discrepancies` (and on `compare_sources`). Discrepancies between sources that are intentionally blended (e.g. OpenAQ vs Open-Meteo AQ) are tagged `expected: true` and don't influence downstream interpretation. Discrepancies no longer penalise the confidence score — they stand on their own for UI-level auditing.

## MCP Tools

| Tool                  | Description                                                                            |
| --------------------- | -------------------------------------------------------------------------------------- |
| `get_conditions`      | Real-time environmental conditions at a coordinate                                     |
| `get_alerts`          | Active natural-hazard alerts nearby (seismic, fire, severe weather, tsunami, cyclones) |
| `get_risk_assessment` | Overall risk score and per-layer breakdown                                             |
| `get_forecast`        | Multi-hazard forecast with per-day risk and confidence (up to 16 days)                 |
| `compare_sources`     | Raw per-source data plus detected discrepancies for auditing                           |

## Quick Start

### Prerequisites

- Node.js >= 20
- pnpm >= 10

### Install

```bash
git clone https://github.com/<your-org>/geohazard.git
cd geohazard
pnpm install
cp .env.example .env   # edit to add optional API keys
```

### Run the MCP server

**stdio transport** (for Claude Desktop, Cursor, etc.) — launch the server entry point directly:

```bash
tsx src/server/index.ts
```

**HTTP transport** (for remote clients or the companion SaaS app):

```bash
pnpm dev:server
# Listening on http://localhost:3000
```

`pnpm dev` runs [src/index.ts](src/index.ts) as a quick smoke test that prints aggregated conditions for Madrid — handy for verifying the aggregator without spinning up the MCP layer.

### Docker

```bash
docker compose up
```

The container starts on port 3000 with HTTP transport. Pass API keys via environment variables in [docker-compose.yml](docker-compose.yml) or a `.env` file.

## Configuration

See [.env.example](.env.example) for all options:

| Variable              | Default  | Description                                                                                                      |
| --------------------- | -------- | ---------------------------------------------------------------------------------------------------------------- |
| `NASA_FIRMS_KEY`      | —        | NASA FIRMS API key ([register](https://firms.modaps.eosdis.nasa.gov/api/map_key/)) — fire layer skipped if unset |
| `OPENAQ_API_KEY`      | —        | OpenAQ API key ([register](https://explore.openaq.org)) — station AQ layer skipped if unset                      |
| `CACHE_TTL_SECONDS`   | `300`    | In-memory cache TTL                                                                                              |
| `DEFAULT_RADIUS_KM`   | `500`    | Default search radius for nearby events (seismic lookback is 7 days)                                             |
| `MCP_PORT`            | `3000`   | HTTP server port                                                                                                 |
| `MCP_TRANSPORT`       | `stdio`  | `stdio` or `http`                                                                                                |
| `MCP_ALLOWED_ORIGINS` | —        | Comma-separated CORS origins                                                                                     |
| `LOG_DIR`             | `./logs` | Directory for discrepancy and request logs                                                                       |
| `LOG_LEVEL`           | `info`   | Log verbosity                                                                                                    |

## Project Structure

```
src/
  types/          Shared TypeScript interfaces
  sources/
    registry.ts   Single source of truth: fetch wiring, freshness, applicability, risk hooks
    http.ts       fetchWithTimeout + sourceError helpers shared by every adapter
    aqi.ts        US EPA AQI computation + µg/m³ → ppb/ppm conversions
    *.ts          One adapter per external data source
  aggregator/
    index.ts      Registry-driven fan-out; merges sources into AggregatedConditions
    riskScore.ts  Per-layer score functions + weighted rollup with critical override
    forecast.ts   Multi-day risk/confidence projection
    compareSources.ts  Cross-source discrepancy detection
  confidence/
    static.ts     okCount / applicableCount, with staleness cutoff
  logger/
    discrepancy.ts  JSONL discrepancy log writer
  server/
    tools/        MCP tool definitions (one file per tool + registry)
    middleware/   CORS, rate limiting, request logging
    http.ts       Express wrapper for HTTP transport
    index.ts      MCP entry point (stdio or HTTP based on MCP_TRANSPORT)
  index.ts        Library export + Madrid smoke test
ml/               Reserved for Phase P4 (XGBoost training, RAG embeddings)
```

## Development

```bash
pnpm typecheck    # Type-check without emitting
pnpm lint         # ESLint
pnpm format       # Prettier (write)
pnpm build        # Compile to dist/
```

Commits follow [Conventional Commits](https://www.conventionalcommits.org/) enforced by commitlint and husky.

## Testing

```bash
pnpm test            # Run the full suite
pnpm test:watch      # Re-run on change
pnpm test:coverage   # HTML coverage report under coverage/
```

The suite is Vitest + supertest and is organized in three tiers under [tests/](tests/):

| Tier     | Location                                                                       | What it covers                                                                                                             |
| -------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Unit     | [tests/aggregator/](tests/aggregator/), [tests/confidence/](tests/confidence/) | Pure scoring, confidence, discrepancy-detection logic                                                                      |
| Adapters | [tests/sources/](tests/sources/)                                               | One file per source — `global.fetch` is stubbed and a fixture asserts normalization of the upstream schema                 |
| Server   | [tests/server/](tests/server/)                                                 | supertest against `buildHttpApp` with the aggregator mocked, covering routing, Zod validation, middleware, and tool wiring |

No live API calls are made. NASA FIRMS and OpenAQ API keys are mocked at the environment level, so the suite runs fully offline.

## License

MIT
