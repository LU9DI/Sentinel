import { evaluateRule, type RuleDefinition } from './ruleEngine.js';

export type PolicyDecision = {
  matchedRuleIds: string[];
  shouldOpenCase: boolean;
  shouldAlert: boolean;
  alertChannels: string[];
  reasons: string[];
};

export function evaluatePolicies(rules: Array<{id:string; definition: RuleDefinition; enabled:boolean}>, input: Parameters<typeof evaluateRule>[1], opts?: { caseOnSeverity?: string; defaultChannels?: string[] }): PolicyDecision {
  const matched = rules.filter(r => r.enabled && evaluateRule(r.definition, input));
  const severity = String(input.severity).toLowerCase();
  const caseOn = opts?.caseOnSeverity ?? 'high';
  const shouldOpenCase = matched.length > 0 && ['high','critical'].includes(severity) || input.score >= 0.65;
  const shouldAlert = input.score >= 0.65 || severity === 'critical' || matched.length >= 2;
  const alertChannels = shouldAlert ? (opts?.defaultChannels?.length ? opts.defaultChannels : ['in_app']) : [];
  return { matchedRuleIds: matched.map(r => r.id), shouldOpenCase, shouldAlert, alertChannels, reasons: matched.map(r => `rule:${r.id}`) };
}
