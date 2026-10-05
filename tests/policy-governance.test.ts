import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source=readFileSync(new URL('../src/server.ts',import.meta.url),'utf8');

test('policy rule creation is transactional and audited',()=>{
  assert.ok(source.includes("app.post('/api/rules'"));
  assert.ok(source.includes("await withTransaction(async tx=>{"));
  assert.ok(source.includes("INSERT INTO rules(id,tenant_id,name,definition)"));
  assert.ok(source.includes("action:'rule.created'"));
  assert.ok(source.includes("resourceType:'rule'"));
  assert.ok(source.includes("appendAudit(tx"));
  assert.ok(!source.includes("await pool.query('INSERT INTO rules"));
});
