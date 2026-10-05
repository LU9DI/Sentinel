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

type StoredAuditEvent = {
  sequence:number;
  tenant_id:string;
  actor_id:string|null;
  action:string;
  resource_type:string;
  resource_id:string|null;
  metadata:unknown;
  previous_hash:string|null;
  hash:string;
};

export type AuditChainVerification =
  | { valid:true; tenantId:string; eventCount:number; lastSequence:number|null }
  | { valid:false; tenantId:string; eventCount:number; sequence:number; reason:string };

function canonicalAuditPayload(event:{
  tenantId:string;
  actorId:string|null;
  action:string;
  resourceType:string;
  resourceId:string|null;
  metadata:unknown;
  previousHash:string|null;
}){
  return JSON.stringify({
    tenantId:event.tenantId,
    actorId:event.actorId,
    action:event.action,
    resourceType:event.resourceType,
    resourceId:event.resourceId,
    metadata:event.metadata,
    previousHash:event.previousHash,
  });
}

function auditHash(event:Parameters<typeof canonicalAuditPayload>[0]){
  return crypto.createHash('sha256').update(canonicalAuditPayload(event)).digest('hex');
}

export async function appendAudit(db:PoolClient,e:AuditEvent){
  // Serialize the audit chain per tenant for the entire transaction. A row-level
  // lock on the current tail is insufficient when a tenant has no audit rows yet.
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',[e.tenantId]);
  const previousHashResult=await db.query('SELECT hash FROM audit_events WHERE tenant_id=$1 ORDER BY sequence DESC LIMIT 1 FOR UPDATE',[e.tenantId]);
  const previousHash=previousHashResult.rows[0]?.hash??null;
  const metadata = e.transition
    ? { ...(e.metadata && typeof e.metadata === 'object' ? e.metadata as Record<string, unknown> : {}), transition: e.transition }
    : e.metadata??{};
  const hash=auditHash({
    tenantId:e.tenantId,
    actorId:e.actorId??null,
    action:e.action,
    resourceType:e.resourceType,
    resourceId:e.resourceId??null,
    metadata,
    previousHash,
  });
  await db.query('INSERT INTO audit_events(tenant_id,actor_id,action,resource_type,resource_id,metadata,previous_hash,hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[e.tenantId,e.actorId??null,e.action,e.resourceType,e.resourceId??null,metadata,previousHash,hash]);
  return hash;
}

export async function verifyAuditChain(db:PoolClient,tenantId:string):Promise<AuditChainVerification>{
  // Verification takes the same tenant advisory lock used by appendAudit so the
  // snapshot cannot be changed halfway through validation.
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',[tenantId]);
  const result=await db.query<StoredAuditEvent>(
    'SELECT sequence,tenant_id,actor_id,action,resource_type,resource_id,metadata,previous_hash,hash FROM audit_events WHERE tenant_id=$1 ORDER BY sequence ASC',
    [tenantId],
  );
  let previousHash:string|null=null;
  let previousSequence:number|null=null;
  for(const event of result.rows){
    if(event.tenant_id!==tenantId){
      return {valid:false,tenantId,eventCount:result.rowCount??0,sequence:event.sequence,reason:'tenant mismatch'};
    }
    if(previousSequence!==null && event.sequence<=previousSequence){
      return {valid:false,tenantId,eventCount:result.rowCount??0,sequence:event.sequence,reason:'sequence is not strictly increasing'};
    }
    if(event.previous_hash!==previousHash){
      return {valid:false,tenantId,eventCount:result.rowCount??0,sequence:event.sequence,reason:'previous_hash does not match the preceding event hash'};
    }
    const expectedHash=auditHash({
      tenantId:event.tenant_id,
      actorId:event.actor_id,
      action:event.action,
      resourceType:event.resource_type,
      resourceId:event.resource_id,
      metadata:event.metadata,
      previousHash:event.previous_hash,
    });
    if(event.hash!==expectedHash){
      return {valid:false,tenantId,eventCount:result.rowCount??0,sequence:event.sequence,reason:'stored hash does not match the canonical event payload'};
    }
    previousHash=event.hash;
    previousSequence=event.sequence;
  }
  return {valid:true,tenantId,eventCount:result.rowCount??0,lastSequence:previousSequence};
}
