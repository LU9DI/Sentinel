import crypto from 'node:crypto'; import type {PoolClient} from 'pg';

type AuditEvent = {
  tenantId:string;
  actorId?:string;
  action:string;
  resourceType:string;
  resourceId?:string;
  metadata?:unknown;
  transition?: {previousState:unknown; nextState:unknown};
};

export async function appendAudit(db:PoolClient,e:AuditEvent){
  // Serialize the audit chain per tenant for the entire transaction. A row-level
  // lock on the current tail is insufficient when a tenant has no audit rows yet.
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',[e.tenantId]);
  const previousHashResult=await db.query('SELECT hash FROM audit_events WHERE tenant_id=$1 ORDER BY sequence DESC LIMIT 1 FOR UPDATE',[e.tenantId]);
  const previousHash=previousHashResult.rows[0]?.hash??null;
  const metadata = e.transition
    ? { ...(e.metadata && typeof e.metadata === 'object' ? e.metadata as Record<string, unknown> : {}), transition: e.transition }
    : e.metadata??{};
  const canonical=JSON.stringify({tenantId:e.tenantId,actorId:e.actorId??null,action:e.action,resourceType:e.resourceType,resourceId:e.resourceId??null,metadata,previousHash});
  const hash=crypto.createHash('sha256').update(canonical).digest('hex');
  await db.query('INSERT INTO audit_events(tenant_id,actor_id,action,resource_type,resource_id,metadata,previous_hash,hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[e.tenantId,e.actorId??null,e.action,e.resourceType,e.resourceId??null,metadata,previousHash,hash]);
  return hash;
}
