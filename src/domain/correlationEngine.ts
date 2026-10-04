import { normalizeSeverity } from './sentinelValidation.js';
import { correlateTemporal, type EntityRelationship, type PatternDefinition, type TemporalSignal, type TemporalCorrelation } from './temporalSequenceEngine.js';

export type Signal = TemporalSignal;
export type Correlation = TemporalCorrelation & { score: number; reasons: string[] };

export function correlateSignals(signals: Signal[], patterns?: PatternDefinition[], relationships: EntityRelationship[] = []): Correlation[] {
  if (patterns?.length) return correlateTemporal(signals, patterns, relationships).map(x => ({ ...x, score: x.confidence, reasons: x.factors.map(f => `${f.type}:${f.evidence}`) }));
  const out: Correlation[] = [];
  for (let i = 0; i < signals.length; i++) for (let j = i + 1; j < signals.length; j++) {
    const a = signals[i], b = signals[j];
    if (a.tenantId !== b.tenantId) continue;
    let score = 0; const reasons: string[] = [];
    const common = a.entityIds.filter(x => b.entityIds.includes(x));
    if (common.length) { score += .5; reasons.push(`shared entities:${common.slice(0, 5).join(',')}`); }
    if (a.type === b.type) { score += .15; reasons.push('same signal type'); }
    const dt = Math.abs(new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
    if (dt <= 15 * 60 * 1000) { score += .2; reasons.push('within 15 minutes'); }
    if (a.lat != null && a.lon != null && b.lat != null && b.lon != null) {
      const R = 6371, dLat = (b.lat - a.lat) * Math.PI / 180, dLon = (b.lon - a.lon) * Math.PI / 180;
      const x = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
      const km = 2 * R * Math.asin(Math.sqrt(x));
      if (km <= 2) { score += .15; reasons.push(`within 2km:${km.toFixed(2)}km`); }
    }
    if (score >= .5) {
      const confidence = Number(Math.min(1, score).toFixed(6));
      const factors = reasons.map((e) => ({ type: e.startsWith('shared') ? 'shared_entity' : e.startsWith('same') ? 'type_relationship' : e.startsWith('within 15') ? 'temporal_sequence' : 'geospatial', weight: 1, evidence: e } as any));
      out.push({ signalIds: [a.id, b.id], patternId: 'legacy-pair', patternVersion: 1, algorithmVersion: 'sentinel-correlation-legacy-compat', confidence, score: confidence, severity: normalizeSeverity(confidence >= .9 ? 'critical' : confidence >= .75 ? 'high' : confidence >= .6 ? 'medium' : 'low'), factors, sequence: [a.type, b.type], startedAt: new Date(Math.min(new Date(a.occurredAt).getTime(), new Date(b.occurredAt).getTime())).toISOString(), endedAt: new Date(Math.max(new Date(a.occurredAt).getTime(), new Date(b.occurredAt).getTime())).toISOString(), reasons });
    }
  }
  return out;
}

export const correlate = correlateSignals;
export { correlateTemporal };
export type { PatternDefinition, TemporalCorrelation };
