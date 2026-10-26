import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('pattern learning has explicit governance lifecycle endpoints', () => {
  const source = fs.readFileSync(new URL('../src/routes/patternLearningRoutes.ts', import.meta.url), 'utf8');
  for (const marker of [
    "previousStatus !== 'pending' && previousStatus !== 'review'",
    "candidate must be approved before promotion",
    "enabled: false",
    "pattern_definition.activated",
    "explicitActivation: true",
  ]) assert.ok(source.includes(marker), `missing governance marker: ${marker}`);
});

test('pattern learning routes are mounted', () => {
  const source = fs.readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
  assert.ok(source.includes("app.use('/api/pattern-learning', patternLearningRouter)"));
  assert.ok(source.includes("import patternLearningRouter from './routes/patternLearningRoutes.js'"));
});


test('database governance contains tenant-safe pattern invariants', () => {
  const source = fs.readFileSync(new URL('../src/infra/db.ts', import.meta.url), 'utf8');
  for (const marker of [
    "status IN ('pending','review','approved','rejected','promoted')",
    'pattern_definitions_tenant_name_version_uq',
    'pattern_definitions_one_active_name_uq',
    'pattern_candidates_reviewer_tenant_fk',
    'origin_candidate_id',
    'pattern_definitions_origin_candidate_tenant_fk',
    'pattern_definitions_activated_by_tenant_fk',
  ]) assert.ok(source.includes(marker), `missing database governance marker: ${marker}`);
});


test('activation serializes versions by tenant and pattern name', () => {
  const source = fs.readFileSync(new URL('../src/routes/patternLearningRoutes.ts', import.meta.url), 'utf8');
  assert.ok(source.includes("ORDER BY pd.id FOR UPDATE"));
  assert.ok(source.includes("SET enabled=false WHERE tenant_id=$1 AND name=$2"));
});

test('promotion serializes version allocation for the same tenant and pattern name', () => {
  const source = fs.readFileSync(new URL('../src/routes/patternLearningRoutes.ts', import.meta.url), 'utf8');
  assert.ok(source.includes("ORDER BY version DESC FOR UPDATE"));
});


test('activation requires promoted lineage and records operational actor', () => {
  const source = fs.readFileSync(new URL('../src/routes/patternLearningRoutes.ts', import.meta.url), 'utf8');
  assert.ok(source.includes("candidateStatus !== 'promoted'"));
  assert.ok(source.includes("activated_by=$3,activated_at=now()"));
  assert.ok(source.includes("origin_candidate_id"));
});


test('active pattern definitions are operationally immutable', () => {
  const source = fs.readFileSync(new URL('../src/infra/db.ts', import.meta.url), 'utf8');
  for (const marker of [
    'prevent_active_pattern_mutation',
    'active pattern definitions are immutable; create a new version',
    'prevent_active_pattern_delete',
    'active pattern definitions cannot be deleted; activate a new version instead',
    'pattern_definitions_active_immutability_trg',
    'pattern_definitions_active_delete_trg',
  ]) assert.ok(source.includes(marker), `missing immutability marker: ${marker}`);
});


test('pattern activation requires a governed database transaction', () => {
  const db = fs.readFileSync(new URL('../src/infra/db.ts', import.meta.url), 'utf8');
  const routes = fs.readFileSync(new URL('../src/routes/patternLearningRoutes.ts', import.meta.url), 'utf8');
  for (const marker of [
    'guard_pattern_activation',
    "current_setting('sentinel.pattern_activation', true)",
    'pattern_definitions_activation_guard_trg',
    'pattern activation requires the governed activation transaction',
  ]) assert.ok(db.includes(marker), `missing activation guard marker: ${marker}`);
  assert.ok(routes.includes("SET LOCAL sentinel.pattern_activation = 'true'"));
});


test('pattern state transitions carry previous and next state in the same transaction audit', () => {
  const audit = fs.readFileSync(new URL('../src/infra/audit.ts', import.meta.url), 'utf8');
  const routes = fs.readFileSync(new URL('../src/routes/patternLearningRoutes.ts', import.meta.url), 'utf8');
  assert.ok(audit.includes('transition?: {previousState:unknown; nextState:unknown}'));
  assert.ok(audit.includes('transition: e.transition'));
  assert.ok(routes.includes('previousStatus'));
  assert.ok(routes.includes('previousEnabled'));
  assert.ok(routes.includes('previousState: { status: previousStatus }'));
  assert.ok(routes.includes('nextState: { status: decision }'));
  assert.ok(routes.includes('previouslyActiveVersions'));
  assert.ok(routes.includes('appendAudit(tx'));
});

test('activation audit is part of the governed activation transaction', () => {
  const routes = fs.readFileSync(new URL('../src/routes/patternLearningRoutes.ts', import.meta.url), 'utf8');
  const activationStart = routes.indexOf("router.post('/definitions/:id/activate'");
  const activationEnd = routes.indexOf("export default router;");
  const activation = routes.slice(activationStart, activationEnd);
  assert.ok(activation.includes('await withTransaction(async tx'));
  assert.ok(activation.includes("SET LOCAL sentinel.pattern_activation = 'true'"));
  assert.ok(activation.includes('await appendAudit(tx'));
  assert.ok(activation.includes('transition:'));
});


test('audit chain serializes each tenant for the full transaction', () => {
  const audit = fs.readFileSync(new URL('../src/infra/audit.ts', import.meta.url), 'utf8');
  assert.ok(audit.includes("import type {PoolClient} from 'pg'"));
  assert.ok(audit.includes('appendAudit(db:PoolClient'));
  assert.ok(audit.includes('pg_advisory_xact_lock(hashtextextended($1, 0))'));
  assert.ok(audit.includes('entire transaction'));
});


test('audit chain exposes deterministic integrity verification', () => {
  const audit = fs.readFileSync(new URL('../src/infra/audit.ts', import.meta.url), 'utf8');
  for (const marker of [
    'export async function verifyAuditChain',
    'pg_advisory_xact_lock(hashtextextended($1, 0))',
    'tenant mismatch',
    'sequence is not strictly increasing',
    'previous_hash does not match the preceding event hash',
    'stored hash does not match the canonical event payload',
    'const expectedHash=auditHash',
    'lastSequence:previousSequence===null?null:previousSequence.toString()',
  ]) assert.ok(audit.includes(marker), `missing audit integrity marker: ${marker}`);
});

test('audit append and verification share one canonical hash function', () => {
  const audit = fs.readFileSync(new URL('../src/infra/audit.ts', import.meta.url), 'utf8');
  assert.equal((audit.match(/function auditHash\(/g) || []).length, 1);
  assert.equal((audit.match(/JSON\.stringify\(/g) || []).length, 1);
  assert.ok(audit.includes('previousHash:event.previousHash'));
  assert.ok(audit.includes('previousHash:event.previous_hash'));
});

test('audit verification does not require contiguous global sequence numbers', () => {
  const audit = fs.readFileSync(new URL('../src/infra/audit.ts', import.meta.url), 'utf8');
  assert.match(audit, /currentSequence\s*<=\s*previousSequence/);
  assert.doesNotMatch(audit, /currentSequence\s*!==\s*previousSequence\s*\+\s*1/);
});


test('audit integrity is exposed as a tenant-scoped read-only operation', () => {
  const source = fs.readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
  assert.ok(source.includes("app.get('/api/audit/integrity'"));
  assert.ok(source.includes("requirePermission('audit:read')"));
  assert.ok(source.includes('verifyAuditChain(tx,req.tenantId!)'));
  assert.ok(source.includes('res.status(result.valid?200:409).json(result)'));
  assert.ok(!source.includes('UPDATE audit_events'));
  assert.ok(!source.includes('DELETE FROM audit_events'));
});


test('all server audit writes use PoolClient transactions', () => {
  const source = fs.readFileSync(new URL('../src/server.ts', import.meta.url), 'utf8');
  assert.ok(!source.includes('appendAudit(pool,'));
  assert.ok(source.includes("withTransaction(async tx=>appendAudit(tx,{tenantId,actorId:sub"));
  assert.ok(source.includes("withTransaction(async tx=>{await tx.query('INSERT INTO entity_relationships"));
});
