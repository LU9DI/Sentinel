import type {Pool,PoolClient} from 'pg';
export async function claimIdempotency(db:Pool|PoolClient,tenantId:string,key:string){const r=await db.query('INSERT INTO idempotency_keys(tenant_id,key) VALUES($1,$2) ON CONFLICT DO NOTHING RETURNING key',[tenantId,key]);return r.rowCount===1}
