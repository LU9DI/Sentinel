import { normalizeSeverity, type Severity } from './sentinelValidation.js';

export type RiskInput = { correlationScore?: number; signalSeverity?: unknown; matchingRules: number; signalCount: number; predictiveScore?: number };
export type RiskResult = { score: number; severity: Severity; reasons: string[] };

export function assessRisk(input: RiskInput): RiskResult {
  const base = (input.correlationScore ?? 0) * 0.50 +
    (Math.min(input.matchingRules, 5) / 5) * 0.18 +
    (Math.min(input.signalCount, 10) / 10) * 0.09 +
    (['high', 'critical'].includes(normalizeSeverity(input.signalSeverity)) ? 0.13 : normalizeSeverity(input.signalSeverity) === 'medium' ? 0.07 : 0);
  const predictive = Math.min(1, Math.max(0, input.predictiveScore ?? 0)) * 0.10;
  const score = Math.min(1, Math.max(0, base + predictive));
  const severity = normalizeSeverity(score >= .85 ? 'critical' : score >= .65 ? 'high' : score >= .4 ? 'medium' : 'low');
  const reasons = [`risk score:${score.toFixed(3)}`];
  if ((input.correlationScore ?? 0) >= .5) reasons.push('correlated signals');
  if (input.matchingRules > 0) reasons.push(`rules matched:${input.matchingRules}`);
  if (input.signalCount > 1) reasons.push(`signal count:${input.signalCount}`);
  if ((input.predictiveScore ?? 0) > 0) reasons.push(`predictive signal:${Number(input.predictiveScore).toFixed(3)}`);
  return { score, severity, reasons };
}
