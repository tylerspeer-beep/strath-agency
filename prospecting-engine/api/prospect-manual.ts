// Strath Agency — Manual Single-Business Trigger
// Vercel function: POST /api/prospect-manual
//
// On-demand injection pathway into the prospecting agent. Built so that a lead or
// customer who reaches out for a manual review can be sourced, scored, audited, and
// pushed into GHL immediately — without waiting for the next scheduled scout/audit
// cron cycle (api/prospect-scout.ts runs daily 08:00 UTC, api/prospect-audit.ts 08:30 UTC).
//
// This mirrors the scout's dedup → filter → entity-resolution → scoring → insert
// pipeline (see api/prospect-scout.ts) but targets ONE named business instead of a
// city-wide Nearby Search sweep, and relaxes the 'locksmith' category gate since the
// business is explicitly named by the caller rather than discovered. It then forces
// the GHL push regardless of the normal raw_score >= 40 threshold (this is an explicit
// manual review request, not a cold-discovery sweep) and immediately calls
// auditOneProspect() (lib/audit-engine.ts) so the GHL profile is fully populated
// (confirmed tier + opportunity) synchronously, in one call, rather than waiting for
// the next audit batch.
//
// Request:
//   POST /api/prospect-manual
//   Authorization: Bearer {CRON_SECRET}   (same secret as the scout/audit crons)
//   Body (JSON): { "businessName": "Car Key Kings", "city": "Ayr" }
//   Optional: { "placeId": "..." } to skip the Find Place lookup if already known.
//
// Scoring is NOT forced — score and tier are whatever scoreProspect()/auditOneProspect()
// actually produce for this business. Only the *GHL push* and *audit* steps are forced
// to run immediately rather than waiting on the normal score threshold / cron schedule.
//
// Env vars required: same as prospect-scout.ts + prospect-audit.ts
//   GOOGLE_PLACES_API_KEY, NEON_DATABASE_URL, GHL_STRATH_OPS_PIT, CRON_SECRET,
//   COMPANIES_HOUSE_API_KEY (optional), ANTHROPIC_API_KEY (optional — falls back to
//   rules-based audit if unset).
//
// NOT on a cron schedule — manual-only. See vercel.json (functions config only).

import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  scoreProspect,
  isWhatsappEligible,
  classifyWebsiteStatus,
  classifyGbpStatus,
  isUrbanCity,
} from '../lib/scoring.js';
import { resolveEntity, type EntityResolution } from '../lib/companies-house.js';
import { createGhlClient, GHL, buildScoutCustomFields } from '../lib/ghl-client.js';
import {
  findProspectByPlaceId,
  findProspectByPhone,
  findProspectByDomain,
  insertProspect,
  updateProspectGhlIds,
  getProspectById,
  normalizePhone,
  extractRootDomain,
} from '../lib/db.js';
import { auditOneProspect, type AuditOneResult } from '../lib/audit-engine.js';
import type { Prospect } from '../lib/types.js';

const PLACES_BASE = 'https://maps.googleapis.com/maps/api/place';

interface PlaceDetails {
  place_id: string;
  name: string;
  formatted_address?: string;
  geometry?: { location: { lat: number; lng: number } };
  rating?: number;
  user_ratings_total?: number;
  website?: string;
  formatted_phone_number?: string;
  international_phone_number?: string;
  types?: string[];
  business_status?: string;
  opening_hours?: unknown;
  url?: string;
}

// Find the single business via Google Places Find Place (text-based), then fetch full
// Place Details. This is the single-business equivalent of the scout's nearbySearch().
async function findPlace(
  businessName: string,
  city: string,
  apiKey: string
): Promise<PlaceDetails | null> {
  const input = encodeURIComponent(`${businessName}, ${city}, UK`);
  const findUrl =
    `${PLACES_BASE}/findplacefromtext/json?input=${input}` +
    `&inputtype=textquery&fields=place_id&key=${apiKey}`;

  const findRes = await fetch(findUrl);
  const findJson = (await findRes.json()) as {
    candidates?: Array<{ place_id: string }>;
    status: string;
  };

  if (findJson.status !== 'OK' || !findJson.candidates?.length) {
    return null;
  }

  return getPlaceDetails(findJson.candidates[0].place_id, apiKey);
}

async function getPlaceDetails(placeId: string, apiKey: string): Promise<PlaceDetails | null> {
  const fields =
    'place_id,name,formatted_address,geometry,rating,user_ratings_total,website,' +
    'formatted_phone_number,international_phone_number,types,business_status,opening_hours,url';
  const detailsUrl = `${PLACES_BASE}/details/json?place_id=${placeId}&fields=${fields}&key=${apiKey}`;

  const detailsRes = await fetch(detailsUrl);
  const detailsJson = (await detailsRes.json()) as { result?: PlaceDetails; status: string };

  if (detailsJson.status !== 'OK' || !detailsJson.result) {
    return null;
  }
  return detailsJson.result;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authHeader = req.headers['authorization'];
  const secret = process.env.CRON_SECRET;
  if (secret && authHeader !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Use POST' });
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GOOGLE_PLACES_API_KEY not configured' });
  }

  const body = (req.body ?? {}) as { businessName?: string; city?: string; placeId?: string };
  const businessName = body.businessName?.trim();
  const city = body.city?.trim();
  const explicitPlaceId = body.placeId?.trim();

  if (!businessName || (!city && !explicitPlaceId)) {
    return res.status(400).json({
      error: 'businessName and city are required (or pass placeId to skip the lookup)',
    });
  }

  try {
    // ── 1. Locate the business ────────────────────────────────────────────────
    const details = explicitPlaceId
      ? await getPlaceDetails(explicitPlaceId, apiKey)
      : await findPlace(businessName, city!, apiKey);

    if (!details) {
      return res.status(404).json({
        error: `Could not find "${businessName}"${city ? ` in ${city}` : ''} via Google Places`,
      });
    }

    if (details.business_status === 'CLOSED_PERMANENTLY' || details.business_status === 'CLOSED_TEMPORARILY') {
      return res.status(409).json({
        error: `${details.name} is marked ${details.business_status} on Google — refusing to log`,
      });
    }

    // NOTE: category gate intentionally relaxed here vs. the scout — this business was
    // explicitly named by the caller (a lead/customer reaching out), not discovered via
    // a 'locksmith' keyword sweep, so we don't require 'locksmith' in details.types[].

    const resolvedCity = city ?? details.formatted_address ?? 'Unknown';
    const rawPhone = details.formatted_phone_number ?? details.international_phone_number;
    const websiteUrl = details.website;

    // ── 2. Dedup checks (mirrors prospect-scout.ts) ──────────────────────────────
    const existingByPlaceId = await findProspectByPlaceId(details.place_id);
    if (existingByPlaceId) {
      // Already in the system — re-run audit on the existing record instead of
      // inserting a duplicate. This covers the case where the lead already has a
      // 'discovered' or stale record and just needs a fresh manual review.
      const existing = await getProspectById(existingByPlaceId.id);
      if (existing) {
        const ghl = createGhlClient();
        const result = await auditOneProspect(existing, ghl, apiKey);
        return res.status(200).json({
          mode: 'existing-prospect-reaudited',
          prospectId: existing.id,
          result,
        });
      }
    }

    if (rawPhone) {
      const existingByPhone = await findProspectByPhone(rawPhone);
      if (existingByPhone) {
        const existing = await getProspectById(existingByPhone.id);
        if (existing) {
          const ghl = createGhlClient();
          const result = await auditOneProspect(existing, ghl, apiKey);
          return res.status(200).json({
            mode: 'existing-prospect-reaudited-by-phone',
            prospectId: existing.id,
            result,
          });
        }
      }
    }

    if (websiteUrl) {
      const domain = extractRootDomain(websiteUrl);
      if (domain) {
        const existingByDomain = await findProspectByDomain(domain);
        if (existingByDomain) {
          const existing = await getProspectById(existingByDomain.id);
          if (existing) {
            const ghl = createGhlClient();
            const result = await auditOneProspect(existing, ghl, apiKey);
            return res.status(200).json({
              mode: 'existing-prospect-reaudited-by-domain',
              prospectId: existing.id,
              result,
            });
          }
        }
      }
    }

    // ── 3. Entity resolution + scoring — run "as is", not forced ────────────────
    const chApiKey = process.env.COMPANIES_HOUSE_API_KEY;
    const entityResolution: EntityResolution = await resolveEntity(
      details.name,
      businessName,
      resolvedCity,
      chApiKey
    ).catch(() => ({ entityType: 'Unknown', confidence: 'not_found' }) as EntityResolution);

    const gbpStatus = classifyGbpStatus(details);
    const websiteStatus = classifyWebsiteStatus(websiteUrl);
    const isUrban = isUrbanCity(resolvedCity);

    const { score, breakdown } = scoreProspect({
      gbpReviewCount: details.user_ratings_total,
      websiteStatus,
      gbpStatus,
      isUrban,
      franchiseFlag: false,
      hasPhone: !!rawPhone,
    });

    const whatsappEligible = isWhatsappEligible(entityResolution.entityType);

    // ── 4. Build + insert the prospect record ────────────────────────────────────
    const prospect: Prospect = {
      businessName: details.name,
      city: resolvedCity,
      fullAddress: details.formatted_address,
      latitude: details.geometry?.location.lat,
      longitude: details.geometry?.location.lng,
      phone: rawPhone,
      websiteUrl,
      whatsappEligible,
      googlePlaceId: details.place_id,
      gbpName: details.name,
      gbpRating: details.rating,
      gbpReviewCount: details.user_ratings_total,
      gbpStatus,
      gbpUrl: details.url,
      gbpCategories: details.types,
      businessStatus: details.business_status,
      entityType: entityResolution.entityType,
      companiesHouseNumber: entityResolution.companiesHouseNumber,
      websiteStatus,
      franchiseFlag: false,
      rawScore: score,
      icpScore: score,
      icpTier: 'ungraded',
      scoreBreakdown: breakdown,
      source: 'manual_trigger',
      status: 'discovered',
    };

    const prospectId = await insertProspect(prospect);

    // ── 5. Force the GHL push — manual review request, no raw_score gate ────────
    const ghl = createGhlClient();
    const customFields = buildScoutCustomFields({
      rawScore: score,
      icpTier: 'Pending Audit',
      websiteStatus,
      gbpStatus,
      gbpRating: details.rating,
      gbpReviewCount: details.user_ratings_total,
      gbpUrl: details.url,
      entityType: entityResolution.entityType,
      companiesHouseNumber: entityResolution.companiesHouseNumber,
      whatsappEligible,
      city: resolvedCity,
      outreachStage: 'Not Contacted',
      businessName: details.name,
      websiteUrl,
    });

    const ghlContactId = await ghl.upsertContact({
      name: details.name,
      phone: rawPhone ? normalizePhone(rawPhone) : undefined,
      website: websiteUrl,
      city: resolvedCity,
      tags: [GHL.TAGS.coldOutreach, 'manual-trigger'],
      customFields,
    });

    await updateProspectGhlIds(prospectId, ghlContactId, undefined);

    // ── 6. Run the full lite audit synchronously — same engine as the cron ──────
    const fullProspect = await getProspectById(prospectId);
    let auditResult: AuditOneResult | null = null;
    let auditError: string | null = null;

    if (fullProspect) {
      try {
        auditResult = await auditOneProspect(fullProspect, ghl, apiKey);
      } catch (err) {
        auditError = String(err).substring(0, 500);
        console.error(`[manual] Audit failed for ${details.name}:`, err);
      }
    }

    return res.status(200).json({
      mode: 'new-prospect-scored-and-audited',
      prospectId,
      ghlContactId,
      rawScoutScore: score,
      scoutScoreBreakdown: breakdown,
      entityResolution,
      whatsappEligible,
      auditResult,
      auditError,
    });
  } catch (err) {
    console.error('[manual] Error:', err);
    return res.status(500).json({ error: String(err) });
  }
}
