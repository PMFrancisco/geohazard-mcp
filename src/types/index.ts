export interface Coordinates {
  lat: number;
  lon: number;
}

export interface SourceResult<T> {
  sourceId: string;
  ok: boolean;
  fetchedAt: Date;
  data: T | null;
  error?: string;
  latencyMs: number;
}

export interface WeatherData {
  tempC: number;
  feelsLikeC: number;
  humidityPct: number;
  windKmh: number;
  precipitationMm: number;
  condition: string;
  uvIndex: number;
}

export interface SeismicEvent {
  id: string;
  magnitude: number;
  depthKm: number;
  distanceKm: number;
  place: string;
  timeUtc: string;
  tsunami: boolean;
}

export interface SeismicData {
  recentEvents: SeismicEvent[];
  nearestEventDistanceKm: number | null;
  maxMagnitude24h: number | null;
}

export interface FireHotspot {
  lat: number;
  lon: number;
  brightness: number;
  confidence: number;
  distanceKm: number;
}

export interface FireData {
  hotspotsNearby: FireHotspot[];
  totalHotspots100km: number;
  totalHotspots500km: number;
  maxBrightness: number | null;
}

export interface AirQualityData {
  aqi: number;
  pm25: number;
  pm10: number;
  no2: number;
  o3: number;
  co?: number;
  category: string;
  dominantPollutant: string;
  /** Which source provided the data */
  source: 'openaq' | 'open-meteo-aq';
  /** Distance to nearest station (OpenAQ only) */
  stationDistanceKm?: number;
}

export interface FloodData {
  returnPeriod: '< 5y' | '> 5y' | '> 20y' | '> 100y';
  dischargeM3s: number | null;
  forecastDays: number;
  riverName: string | null;
}

export interface SpaceWeatherData {
  kpIndex: number;
  kpCategory: string;
  solarWindSpeedKms: number | null;
  geomagneticStorm: boolean;
  auroraAlert: boolean;
}

export interface VolcanicActivity {
  volcanoName: string;
  region: string;
  activityLevel: string;
  date: string;
}

export interface VolcanicData {
  recentActivity: VolcanicActivity[];
  nearbyCount: number;
}

export interface TsunamiWarning {
  id: string;
  severity: string;
  area: string;
  issuedAt: string;
  description: string;
}

export interface TsunamiData {
  activeWarnings: TsunamiWarning[];
  hasActiveWarning: boolean;
}

export interface NWSAlert {
  id: string;
  event: string;
  severity: 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';
  urgency: string;
  headline: string;
  description: string;
  onset: string;
  expires: string;
}

export interface NWSData {
  activeAlerts: NWSAlert[];
  totalAlerts: number;
}

export interface MarineData {
  seaSurfaceTempC: number | null;
  waveHeightM: number | null;
  currentSpeedKms: number | null;
  seaLevelAnomalyM: number | null;
}

export type LayerSource = 'realtime' | 'forecast' | 'decayed';

export interface ForecastDay {
  date: string;
  dayOffset: number;

  // Forecastable layers — real projections per day
  weather?: {
    tempMin: number;
    tempMax: number;
    tempMean: number;
    tempStddev: number;
    precipitationMm: number;
    precipitationProbability: number;
    precipitationStddev: number;
    windMaxKmh: number;
    windMean: number;
    windStddev: number;
    uvMax: number;
    source: LayerSource;
  };
  airQuality?: { pm25: number; pm10: number; aqi: number; source: LayerSource };
  flood?: {
    dischargeM3s: number;
    trend: 'rising' | 'falling' | 'stable';
    source: LayerSource;
  };
  spaceWeather?: { kpIndex: number; category: string; source: LayerSource };

  // Persistent layers — real-time with decay on days 1+
  seismic?: { score: number; decayFactor: number; source: LayerSource };
  fire?: { score: number; decayFactor: number; source: LayerSource };
  volcanic?: { score: number; source: LayerSource };
  tsunami?: { active: boolean; expiresAt: string | null; source: LayerSource };
  nwsAlerts?: {
    count: number;
    maxSeverity: string | null;
    source: LayerSource;
  };
  marine?: { waveHeightM: number | null; source: LayerSource };

  risk: {
    score: number;
    level: RiskLevel;
    mainFactors: string[];
  };
  confidence: {
    overall: number;
    level: ConfidenceLevel;
  };
}

export interface ForecastResponse {
  location: Coordinates;
  /** Full real-time snapshot (day 0 baseline) */
  current: AggregatedConditions;
  days: ForecastDay[];
  models: string[];
  sources: string[];
  generatedAt: string;
}

export interface CompareSourcesResponse {
  location: Coordinates;
  timestampUtc: string;
  sources: Record<
    string,
    { ok: boolean; data: unknown; latencyMs: number; error?: string }
  >;
  discrepancies: Discrepancy[];
}

export type ConfidenceLevel = 'reliable' | 'partial' | 'limited' | 'estimate';

export interface ConfidenceScore {
  overall: number;
  level: ConfidenceLevel;
  label: string;
  factors: {
    sourceRatio: number;
    freshnessAvg: number;
    geoFactor: number;
  };
  sourceDetails: Record<string, { fresh: number; ok: boolean }>;
}

export type RiskLevel = 'minimal' | 'low' | 'moderate' | 'high' | 'critical';

export interface RiskAssessment {
  overallScore: number;
  level: RiskLevel;
  mainFactors: string[];
  layerScores: {
    weather?: number;
    seismic?: number;
    fire?: number;
    airQuality?: number;
    flood?: number;
    space?: number;
  };
}

export interface AggregatedConditions {
  location: Coordinates;
  timestampUtc: string;
  sourcesQueried: string[];
  sourcesFailed: string[];
  weather: WeatherData | null;
  seismic: SeismicData | null;
  fire: FireData | null;
  airQuality: AirQualityData | null;
  flood: FloodData | null;
  spaceWeather: SpaceWeatherData | null;
  volcanic: VolcanicData | null;
  tsunami: TsunamiData | null;
  nwsAlerts: NWSData | null;
  marine: MarineData | null;
  gdacs: import('../sources/gdacs.js').GdacsData | null;
  confidence: ConfidenceScore;
  risk: RiskAssessment;
}

export interface Discrepancy {
  id: string;
  timestampUtc: string;
  location: Coordinates;
  field: string;
  sourceA: string;
  valueA: number;
  sourceB: string;
  valueB: number;
  delta: number;
  relativeDelta: number;
}

export interface AggregatorOptions {
  radiusKm?: number;
  firmsKey?: string;
}
