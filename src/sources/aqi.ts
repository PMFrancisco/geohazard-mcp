/**
 * US EPA Air Quality Index computation.
 *
 * Piecewise-linear interpolation over per-pollutant breakpoints. Returns the
 * worst sub-AQI across the provided pollutants (EPA rule: overall AQI is the
 * maximum of the individual pollutant AQIs).
 *
 * Inputs are all in µg/m³; gas pollutants (O3, NO2, CO) are converted to the
 * volumetric units the EPA breakpoints are defined in (ppb for O3/NO2, ppm
 * for CO) using the standard 25°C, 1 atm factors.
 *
 * PM2.5 breakpoints use the EPA 2024 revision (lowered Good/Moderate bands).
 */

export interface AqiInputs {
  pm25?: number;
  pm10?: number;
  o3?: number;
  no2?: number;
  co?: number;
}

export type Pollutant = 'pm25' | 'pm10' | 'o3' | 'no2' | 'co';

export interface AqiResult {
  aqi: number;
  category: string;
  dominantPollutant: Pollutant;
  /** Pollutants (by key) whose value exceeds the WHO 2021 24-hr guideline. Sorted. */
  whoExceedances: Pollutant[];
}

/**
 * WHO 2021 Global Air Quality Guidelines — 24-hour values (µg/m³).
 * We use 24-hr (not annual) thresholds because we're evaluating spot/latest
 * readings; annual guidelines are aspirational and trigger on nearly every
 * urban reading, making them useless as a yes/no flag.
 */
const WHO_24H: Record<Pollutant, number> = {
  pm25: 15,
  pm10: 45,
  no2: 25,
  o3: 100,
  co: 4000,
};

const POLLUTANT_ORDER: Pollutant[] = ['pm25', 'pm10', 'no2', 'o3', 'co'];

// Each breakpoint row: [C_lo, C_hi, I_lo, I_hi].
// A sample with concentration C in [C_lo, C_hi] maps linearly onto [I_lo, I_hi].
type Breakpoint = [number, number, number, number];

const PM25_BP: Breakpoint[] = [
  [0.0, 9.0, 0, 50],
  [9.1, 35.4, 51, 100],
  [35.5, 55.4, 101, 150],
  [55.5, 125.4, 151, 200],
  [125.5, 225.4, 201, 300],
  [225.5, 500.4, 301, 500],
];

const PM10_BP: Breakpoint[] = [
  [0, 54, 0, 50],
  [55, 154, 51, 100],
  [155, 254, 101, 150],
  [255, 354, 151, 200],
  [355, 424, 201, 300],
  [425, 604, 301, 500],
];

// O3 breakpoints below are for 8-hour ppb.
const O3_BP: Breakpoint[] = [
  [0, 54, 0, 50],
  [55, 70, 51, 100],
  [71, 85, 101, 150],
  [86, 105, 151, 200],
  [106, 200, 201, 300],
  [201, 504, 301, 500],
];

// NO2 breakpoints: 1-hour ppb.
const NO2_BP: Breakpoint[] = [
  [0, 53, 0, 50],
  [54, 100, 51, 100],
  [101, 360, 101, 150],
  [361, 649, 151, 200],
  [650, 1249, 201, 300],
  [1250, 2049, 301, 500],
];

// CO breakpoints: 8-hour ppm.
const CO_BP: Breakpoint[] = [
  [0.0, 4.4, 0, 50],
  [4.5, 9.4, 51, 100],
  [9.5, 12.4, 101, 150],
  [12.5, 15.4, 151, 200],
  [15.5, 30.4, 201, 300],
  [30.5, 50.4, 301, 500],
];

// µg/m³ → volumetric conversion (25°C, 1 atm). Divide by these to go from
// µg/m³ to ppb (O3, NO2) or ppm (CO).
const UGM3_TO_PPB_O3 = 1.963;
const UGM3_TO_PPB_NO2 = 1.882;
const UGM3_TO_PPM_CO = 1145;

function subAqi(concentration: number, bp: Breakpoint[]): number | null {
  if (!Number.isFinite(concentration) || concentration < 0) return null;
  // Clamp above the top breakpoint to the max index (500).
  const top = bp[bp.length - 1];
  if (concentration >= top[1]) return top[3];
  for (const [cLo, cHi, iLo, iHi] of bp) {
    if (concentration >= cLo && concentration <= cHi) {
      const aqi = ((iHi - iLo) / (cHi - cLo)) * (concentration - cLo) + iLo;
      return Math.round(aqi);
    }
  }
  // Gaps between breakpoint bands (e.g. PM2.5 9.0–9.1) — fall back to the
  // nearer edge by piecewise interpolation across the gap.
  for (let i = 0; i < bp.length - 1; i++) {
    const cur = bp[i];
    const next = bp[i + 1];
    if (concentration > cur[1] && concentration < next[0]) {
      const aqi =
        ((next[2] - cur[3]) / (next[0] - cur[1])) * (concentration - cur[1]) +
        cur[3];
      return Math.round(aqi);
    }
  }
  return null;
}

export function aqiCategory(aqi: number): string {
  if (aqi <= 50) return 'Good';
  if (aqi <= 100) return 'Moderate';
  if (aqi <= 150) return 'Unhealthy for Sensitive Groups';
  if (aqi <= 200) return 'Unhealthy';
  if (aqi <= 300) return 'Very Unhealthy';
  return 'Hazardous';
}

function computeWhoExceedances(inputs: AqiInputs): Pollutant[] {
  const exceeded: Pollutant[] = [];
  for (const p of POLLUTANT_ORDER) {
    const value = inputs[p];
    if (value == null || !Number.isFinite(value)) continue;
    if (value > WHO_24H[p]) exceeded.push(p);
  }
  return exceeded;
}

export function computeUsAqi(inputs: AqiInputs): AqiResult {
  const subs: Array<{ pollutant: Pollutant; aqi: number }> = [];

  if (inputs.pm25 != null) {
    const a = subAqi(inputs.pm25, PM25_BP);
    if (a != null) subs.push({ pollutant: 'pm25', aqi: a });
  }
  if (inputs.pm10 != null) {
    const a = subAqi(inputs.pm10, PM10_BP);
    if (a != null) subs.push({ pollutant: 'pm10', aqi: a });
  }
  if (inputs.o3 != null) {
    const a = subAqi(inputs.o3 / UGM3_TO_PPB_O3, O3_BP);
    if (a != null) subs.push({ pollutant: 'o3', aqi: a });
  }
  if (inputs.no2 != null) {
    const a = subAqi(inputs.no2 / UGM3_TO_PPB_NO2, NO2_BP);
    if (a != null) subs.push({ pollutant: 'no2', aqi: a });
  }
  if (inputs.co != null) {
    const a = subAqi(inputs.co / UGM3_TO_PPM_CO, CO_BP);
    if (a != null) subs.push({ pollutant: 'co', aqi: a });
  }

  const whoExceedances = computeWhoExceedances(inputs);

  if (subs.length === 0) {
    return {
      aqi: 0,
      category: aqiCategory(0),
      dominantPollutant: 'pm25',
      whoExceedances,
    };
  }

  let worst = subs[0];
  for (const s of subs) {
    if (s.aqi > worst.aqi) worst = s;
  }
  return {
    aqi: worst.aqi,
    category: aqiCategory(worst.aqi),
    dominantPollutant: worst.pollutant,
    whoExceedances,
  };
}
