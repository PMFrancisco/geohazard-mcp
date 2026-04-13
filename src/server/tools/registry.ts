import { getConditionsTool } from './getConditions.js';
import { getAlertsTool } from './getAlerts.js';
import { getRiskAssessmentTool } from './getRiskAssessment.js';

export const TOOLS = {
  get_conditions: getConditionsTool,
  get_alerts: getAlertsTool,
  get_risk_assessment: getRiskAssessmentTool,
} as const;
