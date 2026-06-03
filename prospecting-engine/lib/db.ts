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

// ── Phone normalization ───────────────────────────────────────────────────────
// Strip everything except digits. Strip UK country code prefix (44) where it
// would make the number 12+ digits (UK numbers are 10-11 digits local form).
// Produces a canonical string for dedup comparison.

export function normalizePhone(phone: string): string {
  let digits = phone.replace(/\D/g, '');
  // UK: +44 7700 900123 → 447700900123 (12 digits) → 07700900123 (11 digits)
  if (digits.startsWith('44') && digits.length >= 12) {
    digits = '0' + digits.slice(2);
  }
  return digits;
}

// ── Domain extraction ─────────────────────────────────────────────────────────
// Extract root domain from a URL, stripping protocol and www prefix.
// Returns null if the URL is unparseable.

export function extractRootDomain(url: string): string | null {
  try {
    const clean = url.startsWith('http') ? url : `https://${url}`;
    const hostname = new URL(clean).hostname.toLowerCase();
    return hostname.startsWith('www.') ? hostname.slice(4) : hostname;
  } catch {
    return null;
  }
}

// ── Row to Prospect mapper ────────────────────────────────────────────────────
// Neon returns snake_case column names. The Prospect interface uses camelCase.
// This mapper is required — direct casts to Prospect[] miss all field names.
// Only maps fields that are read by application code; add more as needed.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToProspect(row: Record<string, any>): Prospect {
  return {
    id:                    row.id,
    createdAt:             row.created_at,
    updatedAt:             row.updated_at,
    businessName:          row.business_name,
    tradingName:           row.trading_name ?? undefined,
    ownerName:             row.owner_name ?? undefined,
    city:                  row.city,
    region:                row.region ?? undefined,
    postcode:              row.postcode ?? undefined,
    fullAddress:           row.full_address ?? undefined,
    latitude:              row.latitude ?? undefined,
    longitude:             row.longitude ?? undefined,
    phone:                 row.phone ?? undefined,
    email:                 row.email ?? undefined,
    websiteUrl:            row.website_url ?? undefined,
    whatsappEligible:      row.whatsapp_eligible ?? undefined,
    googlePlaceId:         row.google_place_id ?? undefined,
    gbpName:               row.gbp_name ?? undefined,
    gbpRating:             row.gbp_rating ?? undefined,
    gbpReviewCount:        row.gbp_review_count ?? undefined,
    gbpStatus:             row.gbp_status ?? undefined,
    gbpUrl:                row.gbp_url ?? undefined,
    entityType:            row.entity_type ?? 'Unknown',
    companiesHouseNumber:  row.companies_house_number ?? undefined,
    companiesHouseName:    row.companies_house_name ?? undefined,
    websiteStatus:         row.website_status ?? undefined,
    hasSchema:             row.has_schema ?? undefined,
    hasTitleTag:           row.has_title_tag ?? undefined,
    titleTagQuality:       row.title_tag_quality ?? undefined,
    mobileOptimised:       row.mobile_optimised ?? undefined,
    hasH1:                 row.has_h1 ?? undefined,
    hasFaq:                row.has_faq ?? undefined,
    agencyWatermark:       row.agency_watermark ?? undefined,
    franchiseFlag:         row.franchise_flag ?? false,
    rawScore:              row.raw_score ?? undefined,
    icpScore:              row.icp_score ?? undefined,
    icpTier:               row.icp_tier ?? undefined,
    scoreBreakdown:        row.score_breakdown ?? undefined,
    nearestCompetitor:     row.nearest_competitor ?? undefined,
    observation1:          row.observation_1 ?? undefined,
    observation2:          row.observation_2 ?? undefined,
    duplicateOfPlaceId:    row.duplicate_of_place_id ?? undefined,
    ghlContactId:          row.ghl_contact_id ?? undefined,
    ghlOpportunityId:      row.ghl_opportunity_id ?? undefined,
    outreachStage:         row.outreach_stage ?? undefined,
    approvedForOutreach:   row.approved_for_outreach ?? false,
    status:                row.status ?? undefined,
    source:                row.source ?? undefined,
    driveLogged:           row.drive_logged ?? false,
  };
}

// ── Prospect queries ──────────────────────────────────────────────────────────

export async function findProspectByPlaceId(placeId: string): Promise<{ id: string } | null> {
  const sql = getDb();
  const rows = await sql`
    SELECT id FROM prospects WHERE google_place_id = ${placeId} LIMIT 1
  `;
  return (rows[0] as { id: string } | undefined) ?? null;
}

// Normalizes both the input phone and the stored phone before comparing.
// Uses Postgres regexp_replace so existing denormalized records are also matched.
export async function findProspectByPhone(phone: string): Promise<{ id: string } | null> {
  const sql = getDb();
  const normalized = normalizePhone(phone);
  const rows = await sql`
    SELECT id FROM prospects
    WHERE regexp_replace(phone, '[^0-9]', '', 'g') = ${normalized}
    LIMIT 1
  `;
  return (rows[0] as { id: string } | undefined) ?? null;
}

// Domain-level dedup: strips protocol and www, compares root domain only.
// Returns the matched prospect's id and place_id so the suppressed record can
// store duplicate_of_place_id for traceability.
export async function findProspectByDomain(
  domain: string
): Promise<{ id: string; googlePlaceId: string } | null> {
  const sql = getDb();
  const rows = await sql`
    SELECT id, google_place_id
    FROM prospects
    WHERE regexp_replace(
      regexp_replace(lower(website_url), '^https?://(www\.)?', ''),
      '/.*$', ''
    ) = ${domain}
    LIMIT 1
  `;
  if (!rows[0]) return null;
  const row = rows[0] as { id: string; google_place_id: string };
  return { id: row.id, googlePlaceId: row.google_place_id };
}

// ── Prospect filter check ─────────────────────────────────────────────────────
// Loads all active filter rules from prospect_filters and checks the prospect
// against them. Returns the first match found.
//
// Result:
//   suppressed: true  → skip insert entirely, log the rule
//   flagged: true     → insert with status='flagged'
//   neither           → proceed normally

export async function checkProspectFilters(prospect: {
  businessName: string;
  googlePlaceId?: string;
  websiteUrl?: string;
}): Promise<{ suppressed: boolean; flagged: boolean; matchedRule?: string }> {
  const sql = getDb();

  // Load all filters once per call. Volume is small (dozens of rules max).
  const filters = await sql`SELECT filter_type, value FROM prospect_filters ORDER BY created_at`;

  const nameLower = prospect.businessName.toLowerCase();
  const domain = prospect.websiteUrl ? extractRootDomain(prospect.websiteUrl) : null;

  for (const f of filters) {
    const { filter_type, value } = f as { filter_type: string; value: string };
    const valueLower = value.toLowerCase();

    switch (filter_type) {
      case 'ignore_place_id':
        if (prospect.googlePlaceId === value) {
          return { suppressed: true, flagged: false, matchedRule: `ignore_place_id: ${value}` };
        }
        break;

      case 'ignore_domain':
        if (domain && domain === valueLower) {
          return { suppressed: true, flagged: false, matchedRule: `ignore_domain: ${value}` };
        }
        break;

      case 'ignore_name_contains':
        if (nameLower.includes(valueLower)) {
          return { suppressed: true, flagged: false, matchedRule: `ignore_name_contains: ${value}` };
        }
        break;

      case 'ignore_keyword':
        // Matches business name or URL
        if (
          nameLower.includes(valueLower) ||
          (prospect.websiteUrl && prospect.websiteUrl.toLowerCase().includes(valueLower))
        ) {
          return { suppressed: true, flagged: false, matchedRule: `ignore_keyword: ${value}` };
        }
        break;

      case 'flag_for_review':
        if (nameLower.includes(valueLower)) {
          return { suppressed: false, flagged: true, matchedRule: `flag_for_review: ${value}` };
        }
        break;
    }
  }

  return { suppressed: false, flagged: false };
}

export async function insertProspect(p: Prospect): Promise<string> {
  const sql = getDb();
  // Normalize phone before storing so future dedup queries work on both sides
  const normalizedPhone = p.phone ? normalizePhone(p.phone) : null;

  const rows = await sql`
    INSERT INTO prospects (
      business_name, trading_name, city, region, postcode, full_address,
      latitude, longitude, phone, email, website_url,
      google_place_id, gbp_name, gbp_rating, gbp_review_count, gbp_status, gbp_url,
      entity_type, website_status, franchise_flag,
      raw_score, icp_score, icp_tier, score_breakdown,
      duplicate_of_place_id,
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
      ${normalizedPhone},
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
      ${p.rawScore ?? null},
      ${p.icpScore ?? null},
      ${p.icpTier ?? 'ungraded'},
      ${p.scoreBreakdown ? JSON.stringify(p.scoreBreakdown) : null},
      ${p.duplicateOfPlaceId ?? null},
      ${p.source ?? 'google_places'},
      ${p.status ?? 'discovered'},
      ${p.rawScore !== undefined ? new Date().toISOString() : null}
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

// Set only the opportunity ID — used by audit cron after tier is confirmed.
export async function updateProspectOpportunityId(
  prospectId: string,
  ghlOpportunityId: string
): Promise<void> {
  const sql = getDb();
  await sql`
    UPDATE prospects SET
      ghl_opportunity_id = ${ghlOpportunityId},
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
    outreachHook?: string;
    icpScore?: number;
    icpTier?: string;
    scoreBreakdown?: object;
    status?: string;
    auditError?: string;
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
      outreach_hook      = COALESCE(${fields.outreachHook ?? null}, outreach_hook),
      icp_score          = COALESCE(${fields.icpScore ?? null}, icp_score),
      icp_tier           = COALESCE(${fields.icpTier ?? null}, icp_tier),
      score_breakdown    = COALESCE(${fields.scoreBreakdown ? JSON.stringify(fields.scoreBreakdown) : null}::jsonb, score_breakdown),
      status             = COALESCE(${fields.status ?? null}, status),
      audit_error        = COALESCE(${fields.auditError ?? null}, audit_error),
      scored_at          = CASE WHEN ${fields.icpScore ?? null} IS NOT NULL THEN now() ELSE scored_at END,
      updated_at         = now()
    WHERE id = ${prospectId}
  `;
}

// ── Scout run logging ─────────────────────────────────────────────────────────

export async function logScoutRun(data: {
  city: string;
  query?: string;
  searchKeyword?: string;
  prospectsFound: number;
  prospectsNew: number;
  prospectsSuppressed?: number;
  tierACCount?: number;
  tierBCount?: number;
  tierCCount?: number;
  error?: string;
  durationMs: number;
}): Promise<void> {
  const sql = getDb();
  // Provide safe fallbacks so NOT NULL columns never receive null
  const safeQuery = data.query ?? `locksmith in ${data.city}, UK`;
  const safeKeyword = data.searchKeyword ?? 'locksmith';
  await sql`
    INSERT INTO scout_runs (
      city, query, search_keyword,
      prospects_found, prospects_new, prospects_suppressed,
      tier_a_count, tier_b_count, tier_c_count,
      error, duration_ms
    ) VALUES (
      ${data.city},
      ${safeQuery},
      ${safeKeyword},
      ${data.prospectsFound},
      ${data.prospectsNew},
      ${data.prospectsSuppressed ?? 0},
      ${data.tierACCount ?? 0},
      ${data.tierBCount ?? 0},
      ${data.tierCCount ?? 0},
      ${data.error ?? null},
      ${data.durationMs}
    )
  `;
}

// ── Prospects pending audit ───────────────────────────────────────────────────
// Returns prospects that the scout has scored but the audit has not yet run on.
// Uses icp_tier = 'ungraded' (set by scout) and raw_score >= 40 as the push threshold.
// Applies rowToProspect() so all camelCase fields are correctly populated.

export async function getProspectsPendingAudit(limit = 10): Promise<Prospect[]> {
  const sql = getDb();
  const rows = await sql`
    SELECT * FROM prospects
    WHERE status = 'discovered'
      AND COALESCE(raw_score, icp_score, 0) >= 40
      AND website_url IS NOT NULL
    ORDER BY COALESCE(raw_score, icp_score, 0) DESC
    LIMIT ${limit}
  `;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (rows as Record<string, any>[]).map(rowToProspect);
}
