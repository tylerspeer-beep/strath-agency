// Strath Agency — Neon DB Client
// Wraps @neondatabase/serverless for Vercel Edge/Node functions.
// Connection string from env: NEON_DATABASE_URL

import { neon } from '@neondatabase/serverless';
import type { Prospect } from './types.js';

function getDb() {
  const url = process.env.NEON_DATABASE_URL;
  if (!url) throw new Error('NEON_DATABASE_URL env var is not set');
  return neon(url);
}

// ── Prospect queries ──────────────────────────────────────────────────────────

export async function findProspectByPlaceId(placeId: string): Promise<{ id: string } | null> {
  const sql = getDb();
  const rows = await sql`
    SELECT id FROM prospects WHERE google_place_id = ${placeId} LIMIT 1
  `;
  return rows[0] as { id: string } | null;
}

export async function findProspectByPhone(phone: string): Promise<{ id: string } | null> {
  const sql = getDb();
  const rows = await sql`
    SELECT id FROM prospects WHERE phone = ${phone} LIMIT 1
  `;
  return rows[0] as { id: string } | null;
}

export async function insertProspect(p: Prospect): Promise<string> {
  const sql = getDb();
  const rows = await sql`
    INSERT INTO prospects (
      business_name, trading_name, city, region, postcode, full_address,
      latitude, longitude, phone, email, website_url,
      google_place_id, gbp_name, gbp_rating, gbp_review_count, gbp_status, gbp_url,
      entity_type, website_status, franchise_flag,
      icp_score, icp_tier, score_breakdown,
      source, status, scored_at
    ) VALUES (
      ${p.businessName},
      ${p.tradingName ?? null},
      ${p.city},
      ${p.region ?? null},
      ${p.postcode ?? null},
      ${p.fullAddress ?? null},
      ${p.latitude ?? null},
      ${p.longitude ?? null},
      ${p.phone ?? null},
      ${p.email ?? null},
      ${p.websiteUrl ?? null},
      ${p.googlePlaceId ?? null},
      ${p.gbpName ?? null},
      ${p.gbpRating ?? null},
      ${p.gbpReviewCount ?? null},
      ${p.gbpStatus ?? null},
      ${p.gbpUrl ?? null},
      ${p.entityType ?? 'Unknown'},
      ${p.websiteStatus ?? null},
      ${p.franchiseFlag ?? false},
      ${p.icpScore ?? null},
      ${p.icpTier ?? null},
      ${p.scoreBreakdown ? JSON.stringify(p.scoreBreakdown) : null},
      ${p.source ?? 'google_places'},
      ${p.status ?? 'discovered'},
      ${p.icpScore !== undefined ? new Date().toISOString() : null}
    )
    RETURNING id
  `;
  return (rows[0] as { id: string }).id;
}

export async function updateProspectGhlIds(
  prospectId: string,
  ghlContactId: string,
  ghlOpportunityId?: string
): Promise<void> {
  const sql = getDb();
  await sql`
    UPDATE prospects SET
      ghl_contact_id = ${ghlContactId},
      ghl_opportunity_id = ${ghlOpportunityId ?? null},
      ghl_synced_at = now(),
      updated_at = now()
    WHERE id = ${prospectId}
  `;
}

export async function updateProspectAudit(
  prospectId: string,
  fields: {
    websiteStatus?: string;
    gbpStatus?: string;
    hasSchema?: boolean;
    hasTitleTag?: boolean;
    titleTagQuality?: string;
    mobileOptimised?: boolean;
    hasH1?: boolean;
    hasFaq?: boolean;
    agencyWatermark?: string;
    nearestCompetitor?: string;
    observation1?: string;
    observation2?: string;
    icpScore?: number;
    icpTier?: string;
    scoreBreakdown?: object;
    status?: string;
  }
): Promise<void> {
  const sql = getDb();
  await sql`
    UPDATE prospects SET
      website_status     = COALESCE(${fields.websiteStatus ?? null}, website_status),
      gbp_status         = COALESCE(${fields.gbpStatus ?? null}, gbp_status),
      has_schema         = COALESCE(${fields.hasSchema ?? null}, has_schema),
      has_title_tag      = COALESCE(${fields.hasTitleTag ?? null}, has_title_tag),
      title_tag_quality  = COALESCE(${fields.titleTagQuality ?? null}, title_tag_quality),
      mobile_optimised   = COALESCE(${fields.mobileOptimised ?? null}, mobile_optimised),
      has_h1             = COALESCE(${fields.hasH1 ?? null}, has_h1),
      has_faq            = COALESCE(${fields.hasFaq ?? null}, has_faq),
      agency_watermark   = COALESCE(${fields.agencyWatermark ?? null}, agency_watermark),
      nearest_competitor = COALESCE(${fields.nearestCompetitor ?? null}, nearest_competitor),
      observation_1      = COALESCE(${fields.observation1 ?? null}, observation_1),
      observation_2      = COALESCE(${fields.observation2 ?? null}, observation_2),
      icp_score          = COALESCE(${fields.icpScore ?? null}, icp_score),
      icp_tier           = COALESCE(${fields.icpTier ?? null}, icp_tier),
      score_breakdown    = COALESCE(${fields.scoreBreakdown ? JSON.stringify(fields.scoreBreakdown) : null}::jsonb, score_breakdown),
      status             = COALESCE(${fields.status ?? null}, status),
      scored_at          = CASE WHEN ${fields.icpScore ?? null} IS NOT NULL THEN now() ELSE scored_at END,
      updated_at         = now()
    WHERE id = ${prospectId}
  `;
}

// ── Scout run logging ─────────────────────────────────────────────────────────

export async function logScoutRun(data: {
  city: string;
  query: string;
  prospectsFound: number;
  prospectsNew: number;
  tierACCount: number;
  tierBCount: number;
  tierCCount: number;
  error?: string;
  durationMs: number;
}): Promise<void> {
  const sql = getDb();
  await sql`
    INSERT INTO scout_runs (
      city, query, prospects_found, prospects_new,
      tier_a_count, tier_b_count, tier_c_count,
      error, duration_ms
    ) VALUES (
      ${data.city},
      ${data.query},
      ${data.prospectsFound},
      ${data.prospectsNew},
      ${data.tierACCount},
      ${data.tierBCount},
      ${data.tierCCount},
      ${data.error ?? null},
      ${data.durationMs}
    )
  `;
}

// ── Prospects pending audit ───────────────────────────────────────────────────

export async function getProspectsPendingAudit(limit = 10): Promise<Prospect[]> {
  const sql = getDb();
  const rows = await sql`
    SELECT * FROM prospects
    WHERE status = 'discovered'
      AND icp_tier IN ('A - Hot (70+)', 'B - Warm (40-69)')
      AND website_url IS NOT NULL
    ORDER BY icp_score DESC
    LIMIT ${limit}
  `;
  return rows as unknown as Prospect[];
}
