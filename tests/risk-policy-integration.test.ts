import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { Pool } from 'pg';
import { spawn } from 'node:child_process';

const databaseUrl = process.env.DATABASE_URL;
const bootstrapToken = process.env.HORUS_BOOTSTRAP_TOKEN;
const port = 5123;
const baseUrl = `http://127.0.0.1:${port}`;

test('real DB path enforces correlation -> risk -> policy -> case -> alert -> outbox', async () => {
  assert.ok(databaseUrl, 'DATABASE_URL is required for integration coverage');
  assert.ok(bootstrapToken, 'HORUS_BOOTSTRAP_TOKEN is required for integration coverage');
  const pool = new Pool({ connectionString: databaseUrl });
  const suffix = crypto.randomUUID();
  const tenantId = `integration-${suffix}`;
  const userId = `integration-user-${suffix}`;
  const entityId = `integration-entity-${suffix}`;
  const server = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: process.cwd(), env: { ...process.env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  try {
    await waitForHealth();
    await pool.query('INSERT INTO tenants(id,name) VALUES($1,$2)', [tenantId, 'Integration Tenant']);
    await pool.query('INSERT INTO users(id,email,name) VALUES($1,$2,$3)', [userId, `${userId}@example.test`, 'Integration User']);
    await pool.query('INSERT INTO memberships(tenant_id,user_id,role,permissions) VALUES($1,$2,$3,$4)', [tenantId, userId, 'owner', JSON.stringify(['signals:write', 'signals:read', 'rules:write', 'risk:read'])]);
    await pool.query('INSERT INTO entity_nodes(tenant_id,id,type,label) VALUES($1,$2,$3,$4)', [tenantId, entityId, 'site', 'Integration Site']);

    const tokenResponse = await fetch(`${baseUrl}/api/auth/token`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-bootstrap-token': bootstrapToken },
      body: JSON.stringify({ tenantId, userId }),
    });
    assert.equal(tokenResponse.status, 200);
    const { token } = await tokenResponse.json();
    assert.ok(token);

    const ruleResponse = await fetch(`${baseUrl}/api/rules`, {
      method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'x-tenant-id': tenantId },
      body: JSON.stringify({ name: 'critical-integration-policy', definition: { minSeverity: 'high', requireEntity: true } }),
    });
    assert.equal(ruleResponse.status, 201);

    const occurredAt = new Date().toISOString();
    for (const key of ['integration-signal-a', 'integration-signal-b']) {
      const response = await fetch(`${baseUrl}/api/signals`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}`, 'idempotency-key': key },
        body: JSON.stringify({ type: 'security_event', severity: 'critical', source: 'integration-test', entityIds: [entityId], lat: -15.78, lon: -47.93, occurredAt, payload: { integration: true } }),
      });
      assert.ok([201, 200].includes(response.status), await response.text());
    }

    const rows = await pool.query(`SELECT
      (SELECT count(*) FROM correlations WHERE tenant_id=$1) AS correlations,
      (SELECT count(*) FROM risk_assessments WHERE tenant_id=$1 AND resource_type='correlation') AS risks,
      (SELECT count(*) FROM cases WHERE tenant_id=$1) AS cases,
      (SELECT count(*) FROM alerts WHERE tenant_id=$1) AS alerts,
      (SELECT count(*) FROM outbox_events WHERE tenant_id=$1) AS outbox`, [tenantId]);
    const result = rows.rows[0];
    assert.equal(Number(result.correlations), 1);
    assert.equal(Number(result.risks), 1);
    assert.equal(Number(result.cases), 1);
    assert.equal(Number(result.alerts), 1);
    assert.equal(Number(result.outbox), 1);

    const audit = await pool.query('SELECT action FROM audit_events WHERE tenant_id=$1 ORDER BY sequence ASC', [tenantId]);
    const actions = audit.rows.map((row) => row.action);
    assert.ok(actions.includes('case.auto_created'));
    assert.ok(actions.includes('correlation.created'));
    assert.ok(actions.includes('signal.ingested'));
  } finally {
    await pool.query('DELETE FROM tenants WHERE id=$1', [tenantId]).catch(() => {});
    await pool.end();
    server.kill('SIGTERM');
  }

  async function waitForHealth() {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      try { if ((await fetch(`${baseUrl}/api/health`)).ok) return; } catch {}
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('server did not become ready');
  }
});
