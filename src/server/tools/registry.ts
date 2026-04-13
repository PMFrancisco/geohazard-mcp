import { getConditionsTool } from './getConditions.js';
import { getAlertsTool } from './getAlerts.js';
import { getRiskAssessmentTool } from './getRiskAssessment.js';
import { getForecastTool } from './getForecast.js';
import { compareSourcesTool } from './compareSources.js';

export const TOOLS = {
  get_conditions: getConditionsTool,
  get_alerts: getAlertsTool,
  get_risk_assessment: getRiskAssessmentTool,
  get_forecast: getForecastTool,
  compare_sources: compareSourcesTool,
} as const;
