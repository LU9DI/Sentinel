import { boundedNumber, normalizeSeverity, type Severity } from './sentinelValidation.js';

export type TemporalSignal = {
  id: string;
  tenantId: string;
  type: string;
  severity: string;
  entityIds: string[];
  lat?: number;
  lon?: number;
  occurredAt: Date | string;
};

export type PatternDefinition = {
  id: string;
  version: number;
  name: string;
  sequence: string[];
  minWindowMs: number;
  preferredWindowMs: number;
  maxWindowMs: number;
  weights?: {
    temporal?: number;
    sharedEntity?: number;
    relatedEntity?: number;
    geospatial?: number;
    typeRelationship?: number;
    sequenceOrder?: number;
    entityGraph?: number;
  };
  geo?: { preferredDistanceKm?: number; maxDistanceKm?: number };
  minConfidence?: number;
  enabled?: boolean;
};

export type EntityRelationship = {
  tenantId: string;
  fromEntityId: string;
  toEntityId: string;
  relationType: string;
  strength: number;
  validFrom?: Date | string;
  validTo?: Date | string | null;
};

export type CorrelationFactor = {
  type: 'shared_entity' | 'related_entity' | 'entity_graph' | 'temporal_sequence' | 'geospatial' | 'type_relationship' | 'sequence_order';
  weight: number;
  evidence: string;
};

export type TemporalCorrelation = {
  signalIds: string[];
  patternId: string;
  patternVersion: number;
  algorithmVersion: string;
  confidence: number;
  severity: Severity;
  factors: CorrelationFactor[];
  sequence: string[];
  startedAt: string;
  endedAt: string;
};

const ALGORITHM_VERSION = 'sentinel-correlation-v10.1';

const ms = (v: Date | string) => new Date(v).getTime();
const clamp = (v: number) => Math.max(0, Math.min(1, Number(v.toFixed(6))));

function haversineKm(a: TemporalSignal, b: TemporalSignal): number | null {
  if (a.lat == null || a.lon == null || b.lat == null || b.lon == null) return null;
  const R = 6371;
  const p1 = a.lat * Math.PI / 180, p2 = b.lat * Math.PI / 180;
  const dp = (b.lat - a.lat) * Math.PI / 180;
  const dl = (b.lon - a.lon) * Math.PI / 180;
  const x = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(x));
}

function pairDistanceKm(sequence: TemporalSignal[]): number | null {
  const values: number[] = [];
  for (let i = 1; i < sequence.length; i++) {
    const d = haversineKm(sequence[i - 1], sequence[i]);
    if (d != null) values.push(d);
  }
  return values.length ? Math.max(...values) : null;
}

function temporalScore(elapsed: number, pattern: PatternDefinition): number {
  if (elapsed < pattern.minWindowMs || elapsed > pattern.maxWindowMs) return 0;
  if (elapsed <= pattern.preferredWindowMs) return 1;
  const tail = pattern.maxWindowMs - pattern.preferredWindowMs;
  return tail <= 0 ? 0 : clamp(1 - (elapsed - pattern.preferredWindowMs) / tail);
}

function sharedEntities(sequence: TemporalSignal[]): string[] {
  if (!sequence.length) return [];
  return sequence.reduce((acc, signal) => acc.filter(id => signal.entityIds.includes(id)), [...sequence[0].entityIds]);
}

function relatedEntities(sequence: TemporalSignal[]): string[] {
  const counts = new Map<string, number>();
  for (const signal of sequence) for (const entity of signal.entityIds) counts.set(entity, (counts.get(entity) ?? 0) + 1);
  return [...counts.entries()].filter(([, count]) => count >= 2).map(([entity]) => entity).sort();
}

function activeAt(r: EntityRelationship, at: number): boolean {
  const from = r.validFrom ? ms(r.validFrom) : Number.NEGATIVE_INFINITY;
  const to = r.validTo ? ms(r.validTo) : Number.POSITIVE_INFINITY;
  return from <= at && at <= to;
}

function entityGraphEvidence(sequence: TemporalSignal[], relationships: EntityRelationship[]): { score: number; evidence: string } | null {
  if (relationships.length === 0 || sequence.length < 2) return null;
  const at = ms(sequence.at(-1)!.occurredAt);
  const adjacency = new Map<string, EntityRelationship[]>();
  for (const r of relationships) {
    if (!activeAt(r, at) || r.strength <= 0) continue;
    const a = adjacency.get(r.fromEntityId) ?? []; a.push(r); adjacency.set(r.fromEntityId, a);
    const b = adjacency.get(r.toEntityId) ?? []; b.push({ ...r, fromEntityId: r.toEntityId, toEntityId: r.fromEntityId }); adjacency.set(r.toEntityId, b);
  }
  let best: { score: number; evidence: string } | null = null;
  const entities = [...new Set(sequence.flatMap(s => s.entityIds))].sort();
  const targets = new Set(entities);
  for (const start of entities) {
    const queue: Array<{ id: string; score: number; path: EntityRelationship[] }> = [{ id: start, score: 1, path: [] }];
    const seen = new Map<string, number>([[start, 1]]);
    while (queue.length) {
      const current = queue.shift()!;
      if (current.path.length >= 3) continue;
      const edges = (adjacency.get(current.id) ?? []).slice().sort((a,b) => `${a.toEntityId}|${a.relationType}`.localeCompare(`${b.toEntityId}|${b.relationType}`));
      for (const edge of edges) {
        const nextScore = current.score * Math.max(0, Math.min(1, edge.strength));
        if (nextScore <= (seen.get(edge.toEntityId) ?? 0)) continue;
        seen.set(edge.toEntityId, nextScore);
        const path = [...current.path, edge];
        if (targets.has(edge.toEntityId) && edge.toEntityId !== start && path.length >= 1) {
          const evidence = `path:${[start, ...path.map(e => e.toEntityId)].join(' → ')}; relations:${path.map(e => e.relationType).join(' → ')}; strength:${nextScore.toFixed(6)}`;
          if (!best || nextScore > best.score || (nextScore === best.score && evidence < best.evidence)) best = { score: nextScore, evidence };
        }
        queue.push({ id: edge.toEntityId, score: nextScore, path });
      }
    }
  }
  return best;
}

function buildFactors(sequence: TemporalSignal[], pattern: PatternDefinition, relationships: EntityRelationship[] = []): CorrelationFactor[] {
  const elapsed = ms(sequence[sequence.length - 1].occurredAt) - ms(sequence[0].occurredAt);
  const factors: CorrelationFactor[] = [];
  const temporal = temporalScore(elapsed, pattern);
  if (temporal > 0) factors.push({ type: 'temporal_sequence', weight: temporal, evidence: `${pattern.sequence.join(' → ')}; elapsed:${elapsed}ms; temporalScore:${temporal}` });

  const shared = sharedEntities(sequence);
  if (shared.length) factors.push({ type: 'shared_entity', weight: Math.min(1, shared.length / Math.max(1, sequence.length)), evidence: `shared:${shared.slice(0, 10).join(',')}` });
  else {
    const related = relatedEntities(sequence);
    if (related.length) factors.push({ type: 'related_entity', weight: Math.min(1, related.length / sequence.length), evidence: `related:${related.slice(0, 10).join(',')}` });
  }

  const graph = entityGraphEvidence(sequence, relationships);
  if (graph) factors.push({ type: 'entity_graph', weight: clamp(graph.score), evidence: graph.evidence });

  const geo = pairDistanceKm(sequence);
  if (geo != null && pattern.geo) {
    const preferred = pattern.geo.preferredDistanceKm ?? pattern.geo.maxDistanceKm ?? 2;
    const max = pattern.geo.maxDistanceKm ?? Math.max(preferred, preferred * 3);
    const geoScore = geo <= preferred ? 1 : geo >= max ? 0 : 1 - ((geo - preferred) / (max - preferred));
    if (geoScore > 0) factors.push({ type: 'geospatial', weight: clamp(geoScore), evidence: `maxAdjacentDistanceKm:${geo.toFixed(3)}; preferred:${preferred}; max:${max}` });
  }

  factors.push({ type: 'type_relationship', weight: 1, evidence: `sequence:${pattern.sequence.join(' → ')}` });
  factors.push({ type: 'sequence_order', weight: 1, evidence: `ordered:${sequence.map(s => s.type).join(' → ')}` });
  return factors;
}

function confidenceFromFactors(factors: CorrelationFactor[], pattern: PatternDefinition): number {
  const w = {
    temporal: pattern.weights?.temporal ?? 0.30,
    sharedEntity: pattern.weights?.sharedEntity ?? 0.22,
    relatedEntity: pattern.weights?.relatedEntity ?? 0.12,
    geospatial: pattern.weights?.geospatial ?? 0.16,
    typeRelationship: pattern.weights?.typeRelationship ?? 0.12,
    sequenceOrder: pattern.weights?.sequenceOrder ?? 0.08,
    entityGraph: pattern.weights?.entityGraph ?? 0.12,
  };
  const sum = w.temporal + w.sharedEntity + w.relatedEntity + w.geospatial + w.typeRelationship + w.sequenceOrder;
  const normalized = Object.fromEntries(Object.entries(w).map(([k, v]) => [k, v / sum]));
  const value = factors.reduce((acc, factor) => {
    const key = factor.type === 'temporal_sequence' ? 'temporal' : factor.type === 'shared_entity' ? 'sharedEntity' : factor.type === 'related_entity' ? 'relatedEntity' : factor.type === 'entity_graph' ? 'entityGraph' : factor.type === 'geospatial' ? 'geospatial' : factor.type === 'type_relationship' ? 'typeRelationship' : 'sequenceOrder';
    return acc + factor.weight * Number(normalized[key]);
  }, 0);
  return clamp(value);
}

function severityForConfidence(confidence: number): Severity {
  return normalizeSeverity(confidence >= .9 ? 'critical' : confidence >= .75 ? 'high' : confidence >= .6 ? 'medium' : 'low');
}

function matchesPattern(signal: TemporalSignal, expected: string) { return signal.type === expected; }

export function generateCandidates(signals: TemporalSignal[], pattern: PatternDefinition): TemporalSignal[][] {
  const sorted = [...signals].sort((a, b) => ms(a.occurredAt) - ms(b.occurredAt) || a.id.localeCompare(b.id));
  const out: TemporalSignal[][] = [];
  const walk = (index: number, position: number, current: TemporalSignal[]) => {
    if (position === pattern.sequence.length) { out.push(current); return; }
    for (let i = index; i < sorted.length; i++) {
      const signal = sorted[i];
      if (!matchesPattern(signal, pattern.sequence[position])) continue;
      if (current.length && ms(signal.occurredAt) < ms(current[current.length - 1].occurredAt)) continue;
      if (current.length && ms(signal.occurredAt) - ms(current[0].occurredAt) > pattern.maxWindowMs) break;
      walk(i + 1, position + 1, [...current, signal]);
    }
  };
  walk(0, 0, []);
  return out;
}

export function correlateTemporal(signals: TemporalSignal[], patterns: PatternDefinition[], relationships: EntityRelationship[] = []): TemporalCorrelation[] {
  const byTenant = new Map<string, TemporalSignal[]>();
  for (const signal of signals) {
    if (!byTenant.has(signal.tenantId)) byTenant.set(signal.tenantId, []);
    byTenant.get(signal.tenantId)!.push(signal);
  }
  const out: TemporalCorrelation[] = [];
  for (const pattern of patterns.filter(p => p.enabled !== false)) {
    boundedNumber(pattern.minWindowMs, 0, Number.MAX_SAFE_INTEGER, 'minWindowMs');
    boundedNumber(pattern.preferredWindowMs, pattern.minWindowMs, pattern.maxWindowMs, 'preferredWindowMs');
    boundedNumber(pattern.maxWindowMs, pattern.preferredWindowMs, Number.MAX_SAFE_INTEGER, 'maxWindowMs');
    for (const tenantSignals of byTenant.values()) {
      for (const sequence of generateCandidates(tenantSignals, pattern)) {
        const factors = buildFactors(sequence, pattern, relationships.filter(r => r.tenantId === sequence[0].tenantId));
        const confidence = confidenceFromFactors(factors, pattern);
        if (confidence < (pattern.minConfidence ?? 0)) continue;
        out.push({ signalIds: sequence.map(s => s.id), patternId: pattern.id, patternVersion: pattern.version, algorithmVersion: ALGORITHM_VERSION, confidence, severity: severityForConfidence(confidence), factors, sequence: sequence.map(s => s.type), startedAt: new Date(ms(sequence[0].occurredAt)).toISOString(), endedAt: new Date(ms(sequence.at(-1)!.occurredAt)).toISOString() });
      }
    }
  }
  return out.sort((a, b) => b.confidence - a.confidence || a.signalIds.join(',').localeCompare(b.signalIds.join(',')));
}

export { ALGORITHM_VERSION };
