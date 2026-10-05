import 'dotenv/config';
import crypto from 'node:crypto';
import express from 'express';
import rateLimit from 'express-rate-limit';
import { migrate, pool, withTransaction } from './infra/db.js';
import { claimsFromMembership, requireAuth, signToken, requirePermission, verifyBootstrapToken } from './infra/auth.js';
import { requireTenant, type TenantRequest } from './middleware/tenant.js';
import { appendAudit, verifyAuditChain } from './infra/audit.js';
import { claimIdempotency } from './infra/idempotency.js';
import { normalizeSeverity, normalizeSignalType, boundedNumber } from './domain/sentinelValidation.js';
import { correlate } from './domain/correlationEngine.js';
import { assessRisk } from './domain/riskEngine.js';
import { evaluatePolicies } from './domain/policyEngine.js';
import { assertTransition } from './domain/caseStateMachine.js';
import { semanticKey, semanticSimilarity } from './domain/semanticDedup.js';
import { evolveRisk, shouldEscalate } from './domain/riskEvolution.js';
import { enqueueOutbox } from './infra/outbox.js';
import { normalizeRelationship } from './domain/entityGraph.js';
import { detectVolumeAnomalies } from './domain/patternLearning.js';
import patternLearningRouter from './routes/patternLearningRoutes.js';
import integrationRouter from './routes/integrationRoutes.js';
import { generatePredictiveSignals, PREDICTIVE_ALGORITHM_VERSION } from './domain/predictiveRisk.js';

const app=express();
app.disable('x-powered-by');
app.use(express.json({limit:'1mb'}));
app.use(rateLimit({windowMs:60_000,max:300,standardHeaders:true,legacyHeaders:false}));

app.get('/api/health',(_,res)=>res.json({ok:true,service:'horus-sentinel-ai'}));
app.use('/api/integrations', integrationRouter);
app.use('/api/pattern-learning', patternLearningRouter);

app.get('/api/audit/integrity',requireAuth,requireTenant,requirePermission('audit:read'),async(req:TenantRequest,res)=>{
  try{
    const result=await withTransaction(async tx=>verifyAuditChain(tx,req.tenantId!));
    res.status(result.valid?200:409).json(result);
  }catch(e){
    res.status(503).json({error:e instanceof Error?e.message:'audit integrity verification unavailable'});
  }
});

app.post('/api/auth/token',async(req,res)=>{
  try{
    if(!process.env.HORUS_BOOTSTRAP_TOKEN)return res.status(503).json({error:'bootstrap authentication not configured'});
    if(!verifyBootstrapToken(req.header('x-bootstrap-token')))return res.status(401).json({error:'invalid bootstrap credential'});
    const tenantId=String(req.body?.tenantId||''),sub=String(req.body?.userId||'');
    if(!tenantId||!sub)return res.status(400).json({error:'tenantId and userId required'});
    const membership=await pool.query(
      'SELECT m.role,m.permissions,t.status FROM memberships m JOIN tenants t ON t.id=m.tenant_id WHERE m.tenant_id=$1 AND m.user_id=$2',
      [tenantId,sub],
    );
    if(!membership.rowCount)return res.status(403).json({error:'user is not a tenant member'});
    if(membership.rows[0].status!=='active')return res.status(403).json({error:'tenant is not active'});
    const rawPermissions=membership.rows[0].permissions;
    const permissions=Array.isArray(rawPermissions)?rawPermissions.map(String):[];
    const claims=claimsFromMembership({sub,tenantId,membership:{role:String(membership.rows[0].role),permissions}});
    await withTransaction(async tx=>appendAudit(tx,{tenantId,actorId:sub,action:'auth.token_issued',resourceType:'user',resourceId:sub,metadata:{role:claims.role,permissionCount:claims.permissions.length}}));
    res.json({token:signToken(claims)});
  }catch(e){res.status(503).json({error:e instanceof Error?e.message:'authentication unavailable'});}
});

app.post('/api/signals',requireAuth,requireTenant,requirePermission('signals:write'),async(req:TenantRequest,res)=>{
  try{
    const key=String(req.header('idempotency-key')||'');
    if(!key)return res.status(400).json({error:'Idempotency-Key required'});
    const id=crypto.randomUUID(),type=normalizeSignalType(req.body?.type),severity=normalizeSeverity(req.body?.severity);
    const occurredAt=new Date(req.body?.occurredAt??Date.now());
    if(Number.isNaN(occurredAt.getTime()))return res.status(400).json({error:'invalid occurredAt'});
    const lat=req.body?.lat==null?null:boundedNumber(req.body.lat,-90,90,'lat');
    const lon=req.body?.lon==null?null:boundedNumber(req.body.lon,-180,180,'lon');
    const entityIds=Array.isArray(req.body?.entityIds)?req.body.entityIds.map(String).slice(0,100):[];
    const result=await withTransaction(async tx=>{
      if(!(await claimIdempotency(tx,req.tenantId!,key)))return {duplicate:true,correlations:0};
      await tx.query('INSERT INTO signals(id,tenant_id,type,severity,source,payload,entity_ids,lat,lon,occurred_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[id,req.tenantId,type,severity,String(req.body?.source||'unknown'),req.body?.payload||{},entityIds,lat,lon,occurredAt]);
      await tx.query('INSERT INTO semantic_fingerprints(id,tenant_id,signal_id,fingerprint) VALUES($1,$2,$3,$4)',[crypto.randomUUID(),req.tenantId,id,semanticKey({type,entityIds,lat,lon,occurredAt:occurredAt.toISOString()})]);
      const recent=(await tx.query('SELECT id,tenant_id AS "tenantId",type,severity,entity_ids AS "entityIds",lat,lon,occurred_at AS "occurredAt" FROM signals WHERE tenant_id=$1 AND occurred_at BETWEEN $2::timestamptz-interval \'30 minutes\' AND $2::timestamptz+interval \'30 minutes\' ORDER BY occurred_at,id',[req.tenantId,occurredAt])).rows;
      const patterns=(await tx.query('SELECT id,version,name,sequence,min_window_ms AS "minWindowMs",preferred_window_ms AS "preferredWindowMs",max_window_ms AS "maxWindowMs",weights,geo,min_confidence AS "minConfidence",enabled FROM pattern_definitions WHERE tenant_id=$1 AND enabled=true ORDER BY id,version DESC',[req.tenantId])).rows.map((p:any)=>({...p,minWindowMs:Number(p.minWindowMs),preferredWindowMs:Number(p.preferredWindowMs),maxWindowMs:Number(p.maxWindowMs)}));
      const relationships=(await tx.query('SELECT tenant_id AS "tenantId",from_entity_id AS "fromEntityId",to_entity_id AS "toEntityId",relation_type AS "relationType",strength,valid_from AS "validFrom",valid_to AS "validTo" FROM entity_relationships WHERE tenant_id=$1',[req.tenantId])).rows;
      const correlations=correlate(recent,patterns.length?patterns:undefined,relationships);
      const predictions=generatePredictiveSignals(recent);
      for(const p of predictions){
        await tx.query('INSERT INTO predictive_signals(id,tenant_id,target_type,target_value,horizon_ms,score,confidence,severity,factors,algorithm_version,generated_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(tenant_id,target_type,target_value,horizon_ms,generated_at,algorithm_version) DO UPDATE SET score=EXCLUDED.score,confidence=EXCLUDED.confidence,severity=EXCLUDED.severity,factors=EXCLUDED.factors',[crypto.randomUUID(),req.tenantId,p.targetType,p.targetValue,p.horizonMs,p.score,p.confidence,p.severity,JSON.stringify(p.factors),PREDICTIVE_ALGORITHM_VERSION,p.generatedAt]);
        await appendAudit(tx,{tenantId:req.tenantId!,actorId:req.actorId,action:'predictive_signal.generated',resourceType:'predictive_signal',resourceId:p.targetType,metadata:p});
      }
      const rules=(await tx.query('SELECT id,enabled,definition FROM rules WHERE tenant_id=$1 AND enabled=true',[req.tenantId])).rows.map((r:any)=>({id:r.id,enabled:r.enabled,definition:r.definition}));
      for(const correlation of correlations){
        const cid=crypto.randomUUID();
        await tx.query('INSERT INTO correlations(id,tenant_id,score,confidence,severity,signal_ids,pattern_id,pattern_version,algorithm_version,reasons,explanation) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[cid,req.tenantId,correlation.score,correlation.confidence,correlation.severity,correlation.signalIds,correlation.patternId,correlation.patternVersion,correlation.algorithmVersion,JSON.stringify(correlation.reasons),{factors:correlation.factors,sequence:correlation.sequence}]);
        for(const factor of correlation.factors)await tx.query('INSERT INTO correlation_factors(correlation_id,tenant_id,factor_type,weight,evidence) VALUES($1,$2,$3,$4,$5)',[cid,req.tenantId,factor.type,factor.weight,factor.evidence]);
        const first=recent.find((s:any)=>s.id===correlation.signalIds[0])??recent[0];
        const preliminary=evaluatePolicies(rules,{signalType:first.type,severity:correlation.severity,score:correlation.score,entityIds:first.entityIds??[],ageMinutes:0});
        const predictiveScore=Math.max(0,...predictions.filter(p=>correlation.sequence.includes(p.targetType)).map(p=>p.score*p.confidence));
        const risk=assessRisk({correlationScore:correlation.score,signalSeverity:correlation.severity,matchingRules:preliminary.matchedRuleIds.length,signalCount:correlation.signalIds.length,predictiveScore});
        const policy=evaluatePolicies(rules,{signalType:first.type,severity:risk.severity,score:risk.score,entityIds:first.entityIds??[],ageMinutes:0});
        await tx.query('INSERT INTO risk_assessments(id,tenant_id,resource_type,resource_id,score,severity,reasons) VALUES($1,$2,$3,$4,$5,$6,$7)',[crypto.randomUUID(),req.tenantId,'correlation',cid,risk.score,risk.severity,JSON.stringify([...risk.reasons,...policy.reasons])]);
        if(policy.shouldOpenCase){
          const caseId=crypto.randomUUID();
          await tx.query('INSERT INTO cases(id,tenant_id,status,severity,correlation_id,title,metadata) VALUES($1,$2,\'open\',$3,$4,$5,$6)',[caseId,req.tenantId,risk.severity,`Sentinel incident ${risk.severity}`,{riskScore:risk.score,matchedRuleIds:policy.matchedRuleIds}]);
          if(policy.shouldAlert)for(const channel of policy.alertChannels){
            const alertId=crypto.randomUUID();
            await tx.query('INSERT INTO alerts(id,tenant_id,case_id,channel,status,payload) VALUES($1,$2,$3,$4,\'pending\',$5) ON CONFLICT(tenant_id,case_id,channel) DO UPDATE SET payload=EXCLUDED.payload',[alertId,req.tenantId,caseId,channel,{risk,correlationId:cid}]);
            const row=await tx.query('SELECT id FROM alerts WHERE tenant_id=$1 AND case_id=$2 AND channel=$3',[req.tenantId,caseId,channel]);
            await enqueueOutbox(tx,{tenantId:req.tenantId!,aggregateType:'alert',aggregateId:row.rows[0].id,eventType:'alert.requested',payload:{alertId:row.rows[0].id,channel,caseId}});
          }
          await appendAudit(tx,{tenantId:req.tenantId!,actorId:req.actorId,action:'case.auto_created',resourceType:'case',resourceId:caseId,metadata:{correlationId:cid,risk,policy}});
        }
        await appendAudit(tx,{tenantId:req.tenantId!,actorId:req.actorId,action:'correlation.created',resourceType:'correlation',resourceId:cid,metadata:{risk,policy,predictiveScore}});
      }
      await appendAudit(tx,{tenantId:req.tenantId!,actorId:req.actorId,action:'signal.ingested',resourceType:'signal',resourceId:id,metadata:{type,severity}});
      return {duplicate:false,correlations:correlations.length,id};
    });
    if(result.duplicate)return res.status(200).json(result);
    res.status(201).json(result);
  }catch(e){res.status(400).json({error:e instanceof Error?e.message:'signal ingestion failed'});}
});

app.get('/api/signals',requireAuth,requireTenant,requirePermission('signals:read'),async(req:TenantRequest,res)=>{
  const r=await pool.query('SELECT id,type,severity,source,payload,entity_ids AS "entityIds",lat,lon,occurred_at AS "occurredAt",created_at AS "createdAt" FROM signals WHERE tenant_id=$1 ORDER BY occurred_at DESC LIMIT 100',[req.tenantId]);res.json({items:r.rows});
});

app.get('/api/predictive-signals',requireAuth,requireTenant,requirePermission('risk:read'),async(req:TenantRequest,res)=>{
  const r=await pool.query('SELECT id,target_type AS "targetType",target_value AS "targetValue",horizon_ms AS "horizonMs",score,confidence,severity,factors,algorithm_version AS "algorithmVersion",generated_at AS "generatedAt" FROM predictive_signals WHERE tenant_id=$1 ORDER BY generated_at DESC LIMIT 100',[req.tenantId]);res.json({items:r.rows});
});

app.get('/api/correlations',requireAuth,requireTenant,requirePermission('correlations:read'),async(req:TenantRequest,res)=>{
  const r=await pool.query('SELECT id,score,confidence,severity,signal_ids AS "signalIds",pattern_id AS "patternId",pattern_version AS "patternVersion",algorithm_version AS "algorithmVersion",reasons,explanation,created_at AS "createdAt" FROM correlations WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100',[req.tenantId]);res.json({items:r.rows});
});

app.post('/api/entities/relationships',requireAuth,requireTenant,requirePermission('signals:write'),async(req:TenantRequest,res)=>{
  try{const relationship=normalizeRelationship({...req.body,tenantId:req.tenantId!});const id=crypto.randomUUID();await withTransaction(async tx=>{await tx.query('INSERT INTO entity_relationships(id,tenant_id,from_entity_id,to_entity_id,relation_type,strength,valid_from,valid_to) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,req.tenantId,relationship.fromEntityId,relationship.toEntityId,relationship.relationType,relationship.strength,relationship.validFrom??null,relationship.validTo??null]);await appendAudit(tx,{tenantId:req.tenantId!,actorId:req.actorId,action:'entity_relationship.created',resourceType:'entity_relationship',resourceId:id,metadata:relationship});});res.status(201).json({id,...relationship});}
  catch(e){res.status(400).json({error:e instanceof Error?e.message:'invalid relationship'});}
});

app.post('/api/pattern-learning/anomalies',requireAuth,requireTenant,requirePermission('risk:write'),async(req:TenantRequest,res)=>{
  const signals=(await pool.query('SELECT id,tenant_id AS "tenantId",type,severity,entity_ids AS "entityIds",lat,lon,occurred_at AS "occurredAt" FROM signals WHERE tenant_id=$1 ORDER BY occurred_at ASC LIMIT 5000',[req.tenantId])).rows;
  res.json({algorithmVersion:'sentinel-learning-v11.1',anomalies:detectVolumeAnomalies(signals)});
});

app.post('/api/rules',requireAuth,requireTenant,requirePermission('rules:write'),async(req:TenantRequest,res)=>{
  try{
    const name=String(req.body?.name||'');
    if(!name)return res.status(400).json({error:'name required'});
    const id=crypto.randomUUID();
    await withTransaction(async tx=>{
      await tx.query('INSERT INTO rules(id,tenant_id,name,definition) VALUES($1,$2,$3,$4)',[id,req.tenantId,name,req.body?.definition||{}]);
      await appendAudit(tx,{tenantId:req.tenantId!,actorId:req.actorId,action:'rule.created',resourceType:'rule',resourceId:id,metadata:{name,definition:req.body?.definition||{}}});
    });
    res.status(201).json({id,name});
  }catch(e){res.status(400).json({error:e instanceof Error?e.message:'rule creation failed'});}
});
app.get('/api/rules',requireAuth,requireTenant,requirePermission('rules:read'),async(req:TenantRequest,res)=>{const r=await pool.query('SELECT id,name,enabled,definition FROM rules WHERE tenant_id=$1 ORDER BY created_at DESC',[req.tenantId]);res.json({items:r.rows});});

app.post('/api/cases/:id/transition',requireAuth,requireTenant,requirePermission('cases:write'),async(req:TenantRequest,res)=>{
  try{const id=String(req.params.id),to=String(req.body?.to||'');const result=await withTransaction(async tx=>{const row=await tx.query('SELECT status,version FROM cases WHERE id=$1 AND tenant_id=$2 FOR UPDATE',[id,req.tenantId]);if(!row.rowCount)return null;assertTransition(row.rows[0].status,to);const updated=await tx.query('UPDATE cases SET status=$1,version=version+1,updated_at=now() WHERE id=$2 AND tenant_id=$3 RETURNING status,version',[to,id,req.tenantId]);await appendAudit(tx,{tenantId:req.tenantId!,actorId:req.actorId,action:'case.state_changed',resourceType:'case',resourceId:id,metadata:{from:row.rows[0].status,to,version:updated.rows[0].version}});return updated.rows[0];});if(!result)return res.status(404).json({error:'case not found'});res.json(result);}
  catch(e){res.status(409).json({error:e instanceof Error?e.message:'transition failed'});}
});

app.get('/api/cases',requireAuth,requireTenant,requirePermission('cases:read'),async(req:TenantRequest,res)=>{const r=await pool.query('SELECT id,status,severity,correlation_id AS "correlationId",title,metadata,version,created_at AS "createdAt",updated_at AS "updatedAt" FROM cases WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100',[req.tenantId]);res.json({items:r.rows});});

app.post('/api/risk/assess',requireAuth,requireTenant,requirePermission('risk:write'),async(req:TenantRequest,res)=>{
  try{const resourceType=String(req.body?.resourceType||'signal'),resourceId=String(req.body?.resourceId||'');if(!resourceId)return res.status(400).json({error:'resourceId required'});const signal=await pool.query('SELECT severity FROM signals WHERE id=$1 AND tenant_id=$2',[resourceId,req.tenantId]);const risk=assessRisk({correlationScore:Number(req.body?.correlationScore||0),signalSeverity:signal.rows[0]?.severity,matchingRules:Number(req.body?.matchingRules||0),signalCount:Number(req.body?.signalCount||1),predictiveScore:Number(req.body?.predictiveScore||0)});const id=crypto.randomUUID();await withTransaction(async tx=>{await tx.query('INSERT INTO risk_assessments(id,tenant_id,resource_type,resource_id,score,severity,reasons) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,req.tenantId,resourceType,resourceId,risk.score,risk.severity,risk.reasons]);await appendAudit(tx,{tenantId:req.tenantId!,actorId:req.actorId,action:'risk.assessed',resourceType,resourceId,metadata:risk});});res.status(201).json({id,...risk});}
  catch(e){res.status(400).json({error:e instanceof Error?e.message:'risk assessment failed'});}
});

app.post('/api/cases/:id/risk/evolve',requireAuth,requireTenant,requirePermission('risk:write'),async(req:TenantRequest,res)=>{
  try{const id=String(req.params.id);const result=await withTransaction(async tx=>{const c=await tx.query('SELECT status,severity FROM cases WHERE id=$1 AND tenant_id=$2 FOR UPDATE',[id,req.tenantId]);if(!c.rowCount)return null;const old=await tx.query('SELECT score,severity FROM incident_risk_current WHERE case_id=$1 AND tenant_id=$2',[id,req.tenantId]);const next=evolveRisk(Number(old.rows[0]?.score??0),String(req.body?.signalSeverity||c.rows[0].severity),Number(req.body?.correlationScore||0),Number(req.body?.signalCount||1));await tx.query('INSERT INTO risk_assessments(id,tenant_id,resource_type,resource_id,score,severity,reasons) VALUES($1,$2,\'case\',$3,$4,$5,$6)',[crypto.randomUUID(),req.tenantId,id,next.score,next.severity,['risk evolution']]);await tx.query('INSERT INTO incident_risk_current(id,tenant_id,case_id,score,severity,reasons,version) VALUES($1,$2,$3,$4,$5,$6,1) ON CONFLICT(tenant_id,case_id) DO UPDATE SET score=EXCLUDED.score,severity=EXCLUDED.severity,reasons=EXCLUDED.reasons,version=incident_risk_current.version+1,updated_at=now()',[crypto.randomUUID(),req.tenantId,id,next.score,next.severity,['risk evolution']]);if(shouldEscalate(String(c.rows[0].severity),next.severity))await appendAudit(tx,{tenantId:req.tenantId!,actorId:req.actorId,action:'case.risk_escalated',resourceType:'case',resourceId:id,metadata:next});return next;});if(!result)return res.status(404).json({error:'case not found'});res.json(result);}
  catch(e){res.status(400).json({error:e instanceof Error?e.message:'risk evolution failed'});}
});

app.get('/api/signals/:id/semantic-duplicates',requireAuth,requireTenant,requirePermission('correlations:read'),async(req:TenantRequest,res)=>{
  try{const r=await pool.query('SELECT id,type,entity_ids AS "entityIds",lat,lon,occurred_at AS "occurredAt",payload FROM signals WHERE id=$1 AND tenant_id=$2',[req.params.id,req.tenantId]);if(!r.rowCount)return res.status(404).json({error:'signal not found'});const base=r.rows[0];const candidates=await pool.query("SELECT id,type,entity_ids AS \"entityIds\",lat,lon,occurred_at AS \"occurredAt\",payload FROM signals WHERE tenant_id=$1 AND id<>$2 AND occurred_at BETWEEN $3::timestamptz-interval '10 minutes' AND $3::timestamptz+interval '10 minutes' LIMIT 100",[req.tenantId,req.params.id,base.occurredAt]);const items=candidates.rows.map((x:any)=>({...x,similarity:semanticSimilarity(base,x)})).filter((x:any)=>x.similarity>=.7).sort((a:any,b:any)=>b.similarity-a.similarity);res.json({fingerprint:semanticKey(base),items});}
  catch(e){res.status(400).json({error:e instanceof Error?e.message:'semantic dedupe failed'});}
});

const port=Number(process.env.PORT||5000);
migrate().then(()=>app.listen(port,()=>console.log(`Horus listening on ${port}`))).catch(error=>{console.error(error);process.exit(1);});
