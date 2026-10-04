import test from 'node:test';
import assert from 'node:assert/strict';
import { claimsFromMembership, verifyBootstrapToken } from '../src/infra/auth.js';

test('bootstrap credential is required and compared safely', () => {
  assert.equal(verifyBootstrapToken(undefined, 'secret'), false);
  assert.equal(verifyBootstrapToken('wrong', 'secret'), false);
  assert.equal(verifyBootstrapToken('secret', 'secret'), true);
});

test('JWT claims are derived from tenant membership, not caller supplied privileges', () => {
  const claims = claimsFromMembership({
    sub: 'user-1',
    tenantId: 'tenant-a',
    membership: { role: 'viewer', permissions: ['signals:read', 'signals:read'] },
  });
  assert.deepEqual(claims, {
    sub: 'user-1',
    tenantId: 'tenant-a',
    role: 'viewer',
    permissions: ['signals:read'],
  });
  assert.notEqual(claims.role, 'owner');
  assert.equal(claims.permissions.includes('cases:write'), false);
});
