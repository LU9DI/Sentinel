import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('pattern learning has explicit governance lifecycle endpoints', () => {
  const source = fs.readFileSync(new URL('../src/routes/patternLearningRoutes.ts', import.meta.url), 'utf8');
  for (const marker of [
    "status !== 'pending' && row.rows[0].status !== 'review'",
    "status !== 'approved'",
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
  assert.ok(source.includes("ORDER BY id FOR UPDATE"));
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
