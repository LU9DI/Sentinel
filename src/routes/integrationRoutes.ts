import { Router } from 'express';
import crypto from 'node:crypto';
import { signToken } from '../infra/auth.js';

const router = Router();
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_BODY_BYTES = 100_000;

function timingSafeHex(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

router.post('/signals', async (req, res) => {
  try {
    const secret = process.env.SENTINEL_INTEGRATION_SECRET;
    if (!secret) return res.status(503).json({ error: 'sentinel integration is not configured' });

    const tenantId = String(req.body?.tenantId || '').trim();
    const source = String(req.body?.source || '').trim();
    const timestamp = String(req.header('x-sentinel-timestamp') || '').trim();
    const signature = String(req.header('x-sentinel-signature') || '').trim();
    const idempotencyKey = String(req.header('idempotency-key') || '').trim();

    if (!tenantId || !source || !timestamp || !signature || !idempotencyKey) {
      return res.status(400).json({ error: 'tenantId, source, timestamp, signature and idempotency-key are required' });
    }
    if (Math.abs(Date.now() - Number(timestamp)) > MAX_CLOCK_SKEW_MS || !/^\d+$/.test(timestamp)) {
      return res.status(401).json({ error: 'integration timestamp outside allowed window' });
    }

    const canonicalBody = JSON.stringify(req.body);
    if (Buffer.byteLength(canonicalBody, 'utf8') > MAX_BODY_BYTES) {
      return res.status(413).json({ error: 'integration payload too large' });
    }
    const expected = crypto.createHmac('sha256', secret).update(timestamp).update('.').update(canonicalBody).digest('hex');
    if (!timingSafeHex(signature, expected)) return res.status(401).json({ error: 'invalid integration signature' });

    const claims = {
      sub: `integration:${source}`,
      tenantId,
      role: 'service',
      permissions: ['signals:write'],
    };
    const token = signToken(claims);
    const port = Number(process.env.PORT || 5000);
    const upstream = await fetch(`http://127.0.0.1:${port}/api/signals`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-tenant-id': tenantId,
        'idempotency-key': idempotencyKey,
      },
      body: canonicalBody,
    });
    const text = await upstream.text();
    res.status(upstream.status).type('application/json').send(text);
  } catch (error) {
    res.status(503).json({ error: error instanceof Error ? error.message : 'integration unavailable' });
  }
});

export default router;
