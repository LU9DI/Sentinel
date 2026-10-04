import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('database schema enforces tenant-scoped foreign keys', () => {
  const source = fs.readFileSync(new URL('../src/infra/db.ts', import.meta.url), 'utf8');
  const constraints = [
    'entity_relationships_from_entity_tenant_fk',
    'entity_relationships_to_entity_tenant_fk',
    'correlation_factors_correlation_tenant_fk',
    'cases_correlation_tenant_fk',
    'incident_risk_case_tenant_fk',
    'alerts_case_tenant_fk',
    'alert_deliveries_alert_tenant_fk',
    'semantic_fingerprints_signal_tenant_fk',
    'audit_events_tenant_fk',
  ];
  for (const name of constraints) assert.match(source, new RegExp(name));
});

test('tenant-scoped uniqueness exists for referenced resources', () => {
  const source = fs.readFileSync(new URL('../src/infra/db.ts', import.meta.url), 'utf8');
  for (const table of ['entity_nodes', 'signals', 'correlations', 'cases', 'alerts']) {
    assert.match(source, new RegExp(table + '_tenant_id_uq'));
  }
});
