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
  category: string;
  dominantPollutant: string;
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
