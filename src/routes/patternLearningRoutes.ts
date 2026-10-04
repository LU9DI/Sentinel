import crypto from 'node:crypto';
import { Router } from 'express';
import { pool, withTransaction } from '../infra/db.js';
import { appendAudit } from '../infra/audit.js';
import { requireAuth, requirePermission } from '../infra/auth.js';
import { requireTenant, type TenantRequest } from '../middleware/tenant.js';
import { candidateToPattern, discoverPatternCandidates } from '../domain/patternLearning.js';

const router = Router();
router.use(requireAuth, requireTenant);

router.post('/discover', requirePermission('risk:write'), async (req: TenantRequest, res) => {
  try {
    const signals = (await pool.query(
      'SELECT id,tenant_id AS "tenantId",type,severity,entity_ids AS "entityIds",lat,lon,occurred_at AS "occurredAt" FROM signals WHERE tenant_id=$1 ORDER BY occurred_at ASC LIMIT 5000',
      [req.tenantId],
    )).rows;
    const candidates = discoverPatternCandidates(signals);
    const created = await withTransaction(async tx => {
      const rows = [];
      for (const candidate of candidates) {
        const id = crypto.randomUUID();
        await tx.query(
          'INSERT INTO pattern_candidates(id,tenant_id,name,sequence,support,occurrences,consistency,candidate_score,preferred_window_ms,max_window_ms,evidence,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,\'pending\')',
          [id, req.tenantId, `Candidate ${candidate.sequence.join(' → ')}`, candidate.sequence, candidate.support, candidate.occurrences, candidate.consistency, candidate.candidateScore, candidate.preferredWindowMs, candidate.maxWindowMs, candidate.evidence],
        );
        rows.push({ id, ...candidate, status: 'pending' });
      }
      if (rows.length) await appendAudit(tx, {
        tenantId: req.tenantId!,
        actorId: req.actorId,
        action: 'pattern_candidates.discovered',
        resourceType: 'pattern_candidate_batch',
        resourceId: rows[0].id,
        metadata: { count: rows.length, algorithmVersion: 'sentinel-learning-v11.1' },
      });
      return rows;
    });
    res.status(201).json({ algorithmVersion: 'sentinel-learning-v11.1', candidates: created });
  } catch (e) {
    res.status(400).json({ error: e instanceof Error ? e.message : 'pattern discovery failed' });
  }
});

router.get('/candidates', requirePermission('risk:read'), async (req: TenantRequest, res) => {
  const result = await pool.query(
    'SELECT id,name,sequence,support,occurrences,consistency,candidate_score AS "candidateScore",preferred_window_ms AS "preferredWindowMs",max_window_ms AS "maxWindowMs",evidence,status,review_notes AS "reviewNotes",reviewed_by AS "reviewedBy",reviewed_at AS "reviewedAt",created_at AS "createdAt" FROM pattern_candidates WHERE tenant_id=$1 ORDER BY created_at DESC',
    [req.tenantId],
  );
  res.json({ items: result.rows });
});

router.post('/candidates/:id/review', requirePermission('risk:write'), async (req: TenantRequest, res) => {
  const id = String(req.params.id);
  const decision = String(req.body?.decision || '').toLowerCase();
  if (decision !== 'approved' && decision !== 'rejected') return res.status(400).json({ error: 'decision must be approved or rejected' });
  const result = await withTransaction(async tx => {
    const row = await tx.query('SELECT status FROM pattern_candidates WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [id, req.tenantId]);
    if (!row.rowCount) return null;
    if (row.rows[0].status !== 'pending' && row.rows[0].status !== 'review') throw new Error('candidate is not reviewable');
    const updated = await tx.query(
      'UPDATE pattern_candidates SET status=$1,review_notes=$2,reviewed_by=$3,reviewed_at=now(),updated_at=now() WHERE id=$4 AND tenant_id=$5 RETURNING id,status,reviewed_by AS "reviewedBy",reviewed_at AS "reviewedAt"',
      [decision, String(req.body?.notes || ''), req.actorId, id, req.tenantId],
    );
    await appendAudit(tx, {
      tenantId: req.tenantId!,
      actorId: req.actorId,
      action: `pattern_candidate.${decision}`,
      resourceType: 'pattern_candidate',
      resourceId: id,
      metadata: { notes: String(req.body?.notes || '') },
    });
    return updated.rows[0];
  });
  if (!result) return res.status(404).json({ error: 'pattern candidate not found' });
  res.json(result);
});

router.post('/candidates/:id/promote', requirePermission('risk:write'), async (req: TenantRequest, res) => {
  const id = String(req.params.id);
  const result = await withTransaction(async tx => {
    const row = await tx.query(
      'SELECT id,name,sequence,support,occurrences,consistency,candidate_score AS "candidateScore",preferred_window_ms AS "preferredWindowMs",max_window_ms AS "maxWindowMs",status FROM pattern_candidates WHERE id=$1 AND tenant_id=$2 FOR UPDATE',
      [id, req.tenantId],
    );
    if (!row.rowCount) return null;
    if (row.rows[0].status !== 'approved') throw new Error('candidate must be approved before promotion');
    const existing = await tx.query(
      'SELECT id,version,enabled FROM pattern_definitions WHERE tenant_id=$1 AND name=$2 ORDER BY version DESC FOR UPDATE',
      [req.tenantId, row.rows[0].name],
    );
    const version = Number(existing.rows[0]?.version || 0) + 1;
    const pattern = candidateToPattern(row.rows[0], crypto.randomUUID(), version);
    await tx.query(
      'INSERT INTO pattern_definitions(id,tenant_id,name,version,sequence,min_window_ms,preferred_window_ms,max_window_ms,weights,geo,min_confidence,enabled,origin_candidate_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,false,$12)',
      [pattern.id, req.tenantId, pattern.name, pattern.version, pattern.sequence, pattern.minWindowMs, pattern.preferredWindowMs, pattern.maxWindowMs, pattern.weights, pattern.geo, pattern.minConfidence],
    );
    await tx.query('UPDATE pattern_candidates SET status=\'promoted\',updated_at=now() WHERE id=$1 AND tenant_id=$2', [id, req.tenantId]);
    await appendAudit(tx, {
      tenantId: req.tenantId!,
      actorId: req.actorId,
      action: 'pattern_definition.promoted',
      resourceType: 'pattern_definition',
      resourceId: pattern.id,
      metadata: { candidateId: id, version, enabled: false },
    });
    return { ...pattern, enabled: false };
  });
  if (!result) return res.status(404).json({ error: 'pattern candidate not found' });
  res.status(201).json(result);
});

router.post('/definitions/:id/activate', requirePermission('rules:write'), async (req: TenantRequest, res) => {
  const id = String(req.params.id);
  const result = await withTransaction(async tx => {
    const definitions = await tx.query(
      'SELECT pd.id,pd.name,pd.version,pd.enabled,pd.origin_candidate_id AS "originCandidateId",pc.status AS "candidateStatus" FROM pattern_definitions pd LEFT JOIN pattern_candidates pc ON pc.id=pd.origin_candidate_id AND pc.tenant_id=pd.tenant_id WHERE pd.tenant_id=$1 AND pd.name=(SELECT name FROM pattern_definitions WHERE id=$2 AND tenant_id=$1) ORDER BY pd.id FOR UPDATE',
      [req.tenantId, id],
    );
    const row = definitions.rows.find((candidate) => candidate.id === id);
    if (!row) return null;
    if (row.enabled) return row;
    if (row.originCandidateId && row.candidateStatus !== 'promoted') throw new Error('pattern candidate must be promoted before activation');
    await tx.query('UPDATE pattern_definitions SET enabled=false WHERE tenant_id=$1 AND name=$2', [req.tenantId, row.name]);
    const updated = await tx.query('UPDATE pattern_definitions SET enabled=true,activated_by=$3,activated_at=now() WHERE id=$1 AND tenant_id=$2 RETURNING id,name,version,enabled,activated_by AS "activatedBy",activated_at AS "activatedAt",origin_candidate_id AS "originCandidateId"', [id, req.tenantId, req.actorId]);
    await appendAudit(tx, {
      tenantId: req.tenantId!,
      actorId: req.actorId,
      action: 'pattern_definition.activated',
      resourceType: 'pattern_definition',
      resourceId: id,
      metadata: { version: row.version, explicitActivation: true },
    });
    return updated.rows[0];
  });
  if (!result) return res.status(404).json({ error: 'pattern definition not found' });
  res.json(result);
});

export default router;
