// Strath Agency — Backfill GHL Contacts
// Vercel function: POST /api/backfill-ghl-contacts
//
// Purpose:
//   Push prospects that exist in Neon but were never synced to GHL.
//   Pre-Session-2 records had broken GHL push (Bug #6 in SESSION_2_DEBRIEF).
//   ~137 records sit at raw_score >= 40 with ghl_contact_id NULL.
//
// What it does per call:
//   1. Loads up to ?limit=N (default 20) prospects matching:
//        ghl_contact_id IS NULL
//        COALESCE(raw_score, icp_score, 0) >= 40
//        status NOT IN ('do_not_contact', 'flagged')
//   2. For each:
//        - Builds scout-time custom fields (same pattern as prospect-scout.ts)
//        - Calls ghl.upsertContact() — dedupes by phone/email inside GHL
//        - Writes the returned contact ID back to Neon via updateProspectGhlIds()
//   3. Returns { processed, succeeded, failed, remaining, results }
//
// Idempotent: re-running is safe. updateProspectGhlIds only fills missing IDs,
// and the query excludes anything already in GHL.
//
// Trigger: manual POST with CRON_SECRET, or wired into a cron later
// Protected: Authorization: Bearer {CRON_SECRET}

import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  createGhlClient,
  GHL,
  buildScoutCustomFields,
} from '../lib/ghl-client.js';
import {
  getProspectsMissingGhlContact,
  updateProspectGhlIds,
  checkProspectFilters,
  normalizePhone,
} from '../lib/db.js';
import { isWhatsappEligible } from '../lib/scoring.js';

const DEFAULT_BATCH = 20;
const MAX_BATCH = 50;
const INTER_CONTACT_DELAY_MS = 300;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authHeader = req.headers['authorization'];
  const secret = process.env.CRON_SECRET;
  if (secret && authHeader !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  const requestedLimit = parseInt(String(req.query.limit ?? DEFAULT_BATCH), 10);
  const limit = Math.min(
    Math.max(1, Number.isFinite(requestedLimit) ? requestedLimit : DEFAULT_BATCH),
    MAX_BATCH
  );

  const startMs = Date.now();
  console.log(`[backfill] Starting — limit: ${limit}`);

  const prospects = await getProspectsMissingGhlContact(limit);

  if (prospects.length === 0) {
    return res.status(200).json({
      processed: 0,
      succeeded: 0,
      failed: 0,
      remaining: 0,
      durationMs: Date.now() - startMs,
      message: 'No prospects need backfill.',
    });
  }

  const ghl = createGhlClient();
  const results: Array<{
    id: string;
    name: string;
    status: 'ok' | 'skipped' | 'failed';
    ghlContactId?: string;
    error?: string;
    reason?: string;
  }> = [];
  let succeeded = 0;
  let failed = 0;
  let skipped = 0;

  for (const prospect of prospects) {
    try {
      // Apply prospect_filters retroactively. A filter added after this prospect
      // was scouted (e.g. Timpson) should still suppress the GHL push here.
      const filterResult = await checkProspectFilters({
        businessName: prospect.businessName,
        googlePlaceId: prospect.googlePlaceId,
        websiteUrl: prospect.websiteUrl,
      });
      if (filterResult.suppressed || filterResult.flagged) {
        results.push({
          id: prospect.id!,
          name: prospect.businessName,
          status: 'skipped',
          reason: filterResult.matchedRule ?? 'filter_match',
        });
        skipped++;
        console.log(`[backfill] SKIP ${prospect.businessName} — ${filterResult.matchedRule}`);
        continue;
      }

      const score = prospect.rawScore ?? prospect.icpScore;

      // Audit may have already run on these, so prefer the confirmed tier when present.
      // Otherwise mark as Pending Audit — same as the scout does at discovery.
      const icpTier = prospect.icpTier && prospect.icpTier !== 'ungraded'
        ? prospect.icpTier
        : 'Pending Audit';

      const customFields = buildScoutCustomFields({
        rawScore: score,
        icpTier,
        websiteStatus: prospect.websiteStatus,
        gbpStatus: prospect.gbpStatus,
        gbpRating: prospect.gbpRating,
        gbpReviewCount: prospect.gbpReviewCount,
        gbpUrl: prospect.gbpUrl,
        entityType: prospect.entityType,
        companiesHouseNumber: prospect.companiesHouseNumber,
        whatsappEligible: prospect.whatsappEligible ?? isWhatsappEligible(prospect.entityType),
        city: prospect.city,
        outreachStage: prospect.outreachStage ?? 'Not Contacted',
        titleTagQuality: prospect.titleTagQuality,
        businessName: prospect.businessName,
        websiteUrl: prospect.websiteUrl,
      });

      const ghlContactId = await ghl.upsertContact({
        name: prospect.businessName,
        phone: prospect.phone ? normalizePhone(prospect.phone) : undefined,
        email: prospect.email,
        website: prospect.websiteUrl,
        city: prospect.city,
        tags: [GHL.TAGS.coldOutreach],
        customFields,
      });

      await updateProspectGhlIds(prospect.id!, ghlContactId);

      results.push({
        id: prospect.id!,
        name: prospect.businessName,
        status: 'ok',
        ghlContactId,
      });
      succeeded++;

      console.log(`[backfill] OK: ${prospect.businessName} → contact ${ghlContactId}`);

    } catch (err) {
      const message = String(err).substring(0, 500);
      results.push({
        id: prospect.id!,
        name: prospect.businessName,
        status: 'failed',
        error: message,
      });
      failed++;
      console.error(`[backfill] FAILED: ${prospect.businessName} — ${message}`);
    }

    // Small delay to be polite to the GHL API
    await new Promise(r => setTimeout(r, INTER_CONTACT_DELAY_MS));
  }

  // Quick "remaining" estimate: query one more page beyond what we processed.
  // If the next page is empty we know we're done; otherwise the count signals more work.
  const nextPage = await getProspectsMissingGhlContact(limit).catch(() => []);
  const remaining = nextPage.length;

  return res.status(200).json({
    processed: prospects.length,
    succeeded,
    failed,
    skipped,
    remaining,
    durationMs: Date.now() - startMs,
    results,
  });
}
