import { boundedNumber } from './sentinelValidation.js';
import type { EntityRelationship } from './temporalSequenceEngine.js';

export type EntityNode = {
  tenantId: string;
  id: string;
  type: string;
  label?: string;
  metadata?: Record<string, unknown>;
};

export function normalizeRelationship(input: Partial<EntityRelationship> & { tenantId: string }): EntityRelationship {
  const fromEntityId = String(input.fromEntityId || '');
  const toEntityId = String(input.toEntityId || '');
  const relationType = String(input.relationType || 'related');
  if (!fromEntityId || !toEntityId || fromEntityId === toEntityId) throw new Error('valid distinct entity endpoints required');
  const strength = boundedNumber(input.strength ?? 0, 0, 1, 'strength');
  const validFrom = input.validFrom ? new Date(input.validFrom).toISOString() : undefined;
  const validTo = input.validTo ? new Date(input.validTo).toISOString() : null;
  if (validFrom && Number.isNaN(new Date(validFrom).getTime())) throw new Error('invalid validFrom');
  if (validTo && Number.isNaN(new Date(validTo).getTime())) throw new Error('invalid validTo');
  if (validFrom && validTo && validFrom > validTo) throw new Error('validFrom must be <= validTo');
  return { tenantId: input.tenantId, fromEntityId, toEntityId, relationType, strength, validFrom, validTo };
}

export function relationKey(r: EntityRelationship): string {
  const a = r.fromEntityId < r.toEntityId ? r.fromEntityId : r.toEntityId;
  const b = r.fromEntityId < r.toEntityId ? r.toEntityId : r.fromEntityId;
  return `${a}|${b}|${r.relationType}|${r.validFrom ?? ''}|${r.validTo ?? ''}`;
}
