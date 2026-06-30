// Strath Agency — Lite Audit Function (Session 2: Claude Sonnet Engine)
// Vercel function: POST /api/prospect-audit
//
// This is the daily cron batch endpoint. It pulls its work queue from Neon
// (getProspectsPendingAudit) and runs each prospect through the shared
// auditOneProspect() function in lib/audit-engine.ts.
//
// The per-prospect audit logic (website fetch, Claude analysis, franchise
// detection, scoring, GHL push) was extracted to lib/audit-engine.ts so it can
// also be called synchronously by api/prospect-manual.ts for the on-demand
// single-business trigger pathway. No behavior change from the prior inline
// version — this file is now just the batch-queue driver + auth + response shape.
//
// Env vars required:
//   ANTHROPIC_API_KEY    — Claude Sonnet/Haiku access
//   GOOGLE_PLACES_API_KEY — competitor lookup
//   NEON_DATABASE_URL    — DB writes
//   GHL_STRATH_OPS_PIT   — GHL contact updates
//   CRON_SECRET          — endpoint protection
//
// Called by: Vercel cron (POST /api/prospect-audit?batch=10)
// Protected: Authorization: Bearer {CRON_SECRET}

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createGhlClient } from '../lib/ghl-client.js';
import { getProspectsPendingAudit, updateProspectAudit } from '../lib/db.js';
import { auditOneProspect, type AuditOneResult } from '../lib/audit-engine.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authHeader = req.headers['authorization'];
  const secret = process.env.CRON_SECRET;
  if (secret && authHeader !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  const batchSize = parseInt(String(req.query.batch ?? '5'), 10);
  const apiKey = process.env.GOOGLE_PLACES_API_KEY ?? '';

  console.log(`[audit] Starting batch of ${batchSize}`);

  const prospects = await getProspectsPendingAudit(batchSize);
  const results: AuditOneResult[] = [];

  const ghl = createGhlClient();

  for (const prospect of prospects) {
    try {
      const result = await auditOneProspect(prospect, ghl, apiKey);
      results.push(result);
    } catch (err) {
      console.error(`[audit] Error auditing ${prospect.businessName}:`, err);
      // Persist the error so we can identify and retry failed audits
      if (prospect.id) {
        await updateProspectAudit(prospect.id, {
          auditError: String(err).substring(0, 500),
        }).catch(() => {/* ignore DB error on error write */});
      }
    }
  }

  return res.status(200).json({
    audited: results.length,
    results,
  });
}
