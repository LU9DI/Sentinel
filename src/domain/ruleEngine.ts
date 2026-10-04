import { normalizeSeverity, type Severity } from './sentinelValidation.js';

export type RuleDefinition = {
  signalTypes?: string[];
  minSeverity?: Severity;
  minScore?: number;
  requireEntity?: boolean;
  maxAgeMinutes?: number;
};

const severityRank: Record<Severity, number> = { low: 1, medium: 2, high: 3, critical: 4 };

export function evaluateRule(rule: RuleDefinition, input: {
  signalType: string;
  severity: unknown;
  score: number;
  entityIds: string[];
  ageMinutes: number;
}): boolean {
  if (rule.signalTypes?.length && !rule.signalTypes.includes(input.signalType)) return false;
  if (rule.minSeverity && severityRank[normalizeSeverity(input.severity)] < severityRank[rule.minSeverity]) return false;
  if (rule.minScore != null && input.score < rule.minScore) return false;
  if (rule.requireEntity && input.entityIds.length === 0) return false;
  if (rule.maxAgeMinutes != null && input.ageMinutes > rule.maxAgeMinutes) return false;
  return true;
}
