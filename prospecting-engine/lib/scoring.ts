// Strath Agency — ICP / Opportunity Scoring Library
// SINGLE SOURCE OF TRUTH for all prospect scoring. Both the scout (raw_score)
// and the audit (icp_score) call scoreProspect(); the report renders the STORED
// breakdown via SCORE_WEIGHTS / PRESENCE_KEYS below — it does NOT compute its own.
//
// Model: GBP-first, 0–100 reachable scale. Higher score = bigger opportunity =
// stronger ICP (a weak online presence is what makes a good Strath prospect).
// Rationale: for local locksmiths the map pack + reviews + phone capture the lead;
// the website is ~15% of local-pack weight and is treated as a support signal.
// See CLAUDE.md §17 and docs/AUDIT_RECONCILIATION.md for the full rubric + rationale.
//
// Weights (max 100):
//   PRESENCE (shown in prospect report, max 75):
//     Google Reviews:  30  (<15 → 30 | 15–40 → 18 | 40+ → 6)
//     GBP status:      25  (Unclaimed → 25 | Claimed-Basic → 18 | Claimed-Optimised → 6)
//     Website support: 12  (None → 12 | Basic/Old → 10 | Modern → 5 | Optimised → 1)
//     Phone/contact:   8   (no public phone → 8 | reachable phone → 0)
//   FIT (internal ICP qualifiers, max 25):
//     Entity (Ltd):    10  (Ltd → 10 | Sole Trader/Partnership/Unknown → 5)
//     Urban/proximity: 8   (urban → 8 | else 0)
//     Not franchise:   7   (independent → 7 | franchise/aggregator → 0)
//
// Tiers: A = 70+, B = 40–69, C = <40 (unchanged — preserves GHL option strings + indexes).
//
// NOTE on the Phone signal: v1 measures contactability only (does a public phone
// exist). True missed-call / speed-to-lead handling — the sharpest commercial hook —
// requires a live call test or a connected-client integration and is NOT yet wired.
// The category exists as a first-class slot so that enrichment lands without a
// reweight. See docs/AUDIT_RECONCILIATION.md §C.

import type { ScoreBreakdown, IcpTier, WebsiteStatus, GbpStatus, EntityType } from './types.js';

// ── Weight table (single source of truth for maximums) ────────────────────────
// Exported so the report can render stored points against their maxima without
// re-implementing any scoring logic.
export const SCORE_WEIGHTS = {
  reviews: 30,
  gbp: 25,
  website: 12,
  phone: 8,
  entity: 10,
  urban: 8,
  notFranchise: 7,
} as const;

// Categories surfaced in the prospect-facing report (the "online presence" view).
export const PRESENCE_KEYS = ['reviews', 'gbp', 'website', 'phone'] as const;
// Internal ICP qualifiers — never shown to the prospect.
export const FIT_KEYS = ['entity', 'urban', 'notFranchise'] as const;
// Sum of the presence weights (30 + 25 + 12 + 8).
export const PRESENCE_MAX = SCORE_WEIGHTS.reviews + SCORE_WEIGHTS.gbp + SCORE_WEIGHTS.website + SCORE_WEIGHTS.phone;

export interface ScoringInputs {
  gbpReviewCount?: number;
  websiteStatus?: WebsiteStatus;
  gbpStatus?: GbpStatus;
  entityType?: EntityType;
  isUrban?: boolean;          // city population > ~50k = true
  franchiseFlag?: boolean;
  hasPhone?: boolean;         // true if a public phone number is known (GBP or website)
}

export function scoreProspect(inputs: ScoringInputs): {
  score: number;
  tier: IcpTier;
  breakdown: ScoreBreakdown;
} {
  const breakdown: ScoreBreakdown = {
    reviews: 0,
    gbp: 0,
    website: 0,
    phone: 0,
    entity: 0,
    urban: 0,
    notFranchise: 0,
    total: 0,
  };

  // ── Google Reviews (max 30) ──
  const reviews = inputs.gbpReviewCount ?? 0;
  if (reviews < 15)        breakdown.reviews = 30;
  else if (reviews <= 40)  breakdown.reviews = 18;
  else                     breakdown.reviews = 6;

  // ── GBP status (max 25) — GBP-first: the map listing is the lead-capture asset ──
  switch (inputs.gbpStatus) {
    case 'Unclaimed':           breakdown.gbp = 25; break;
    case 'Claimed - Basic':     breakdown.gbp = 18; break;
    case 'Claimed - Optimised': breakdown.gbp = 6;  break;
    default:                    breakdown.gbp = 18; // unknown = assume claimed basic
  }

  // ── Website (max 12) — support signal only, deliberately demoted ──
  switch (inputs.websiteStatus) {
    case 'None':        breakdown.website = 12; break;
    case 'Basic/Old':   breakdown.website = 10; break;
    case 'Modern':      breakdown.website = 5;  break;
    case 'Optimised':   breakdown.website = 1;  break;
    default:            breakdown.website = 10; // unknown = treat as Basic/Old
  }

  // ── Phone / contactability (max 8) ──
  // v1: contactability only. No public phone is a major (rare) gap → full points.
  // A reachable phone scores 0 here; missed-call/speed-to-lead handling is a
  // future enrichment of this slot (see header note).
  breakdown.phone = inputs.hasPhone === false ? 8 : 0;

  // ── Entity (max 10) ──
  // NOTE: the entity signal's REAL purpose is compliance/contactability, not
  // desirability — Ltd vs sole trader sets WhatsApp/text eligibility under PECR.
  // PROPOSED (pending sign-off, see JOBS_TO_BE_DONE.md / CLAUDE.md §16–17): move this
  // out of the 0–100 desirability score into a separate contactability flag. Until
  // that's approved (it shifts tier math), it stays as a +5 delta fit weight.
  breakdown.entity = inputs.entityType === 'Ltd' ? 10 : 5;

  // ── Urban / proximity (max 8) ──
  breakdown.urban = inputs.isUrban !== false ? 8 : 0;

  // ── Not franchise (max 7) ──
  breakdown.notFranchise = inputs.franchiseFlag ? 0 : 7;

  // ── Total (0–100) ──
  breakdown.total =
    breakdown.reviews +
    breakdown.gbp +
    breakdown.website +
    breakdown.phone +
    breakdown.entity +
    breakdown.urban +
    breakdown.notFranchise;

  const tier: IcpTier =
    breakdown.total >= 70 ? 'A - Hot (70+)' :
    breakdown.total >= 40 ? 'B - Warm (40-69)' :
                            'C - Cold (<40)';

  return { score: breakdown.total, tier, breakdown };
}

// ── Website status classifier ────────────────────────────────────────────────
// Called during discovery (before full audit) using only the Places API data.
// A full audit refines this later.

export function classifyWebsiteStatus(websiteUrl?: string): WebsiteStatus {
  if (!websiteUrl) return 'None';
  // Without fetching the page we can only say it exists.
  // The lite audit will upgrade this to Modern / Optimised.
  return 'Basic/Old';
}

// ── GBP status classifier ─────────────────────────────────────────────────────
// Derives GBP status from Places API data alone.
// Places API does not expose "claimed" status directly —
// we infer it from data completeness.

export function classifyGbpStatus(place: {
  rating?: number;
  user_ratings_total?: number;
  website?: string;
  formatted_phone_number?: string;
  opening_hours?: unknown;
}): GbpStatus {
  const signals = [
    place.rating !== undefined,
    (place.user_ratings_total ?? 0) > 0,
    !!place.website,
    !!place.formatted_phone_number,
    !!place.opening_hours,
  ].filter(Boolean).length;

  if (signals <= 1) return 'Unclaimed';
  if (signals <= 3) return 'Claimed - Basic';
  return 'Claimed - Optimised';
}

// ── Urban classifier ──────────────────────────────────────────────────────────
// UK cities and large towns considered urban for ICP scoring.

const URBAN_CITIES = new Set([
  'glasgow', 'edinburgh', 'aberdeen', 'dundee', 'inverness',
  'perth', 'stirling', 'falkirk', 'hamilton', 'livingston',
  'london', 'manchester', 'birmingham', 'leeds', 'sheffield',
  'liverpool', 'bristol', 'newcastle', 'nottingham', 'leicester',
  'coventry', 'kingston upon hull', 'bradford', 'cardiff', 'belfast',
  'derby', 'wolverhampton', 'southampton', 'portsmouth', 'reading',
  'brighton', 'oxford', 'cambridge', 'exeter', 'plymouth',
  'york', 'swansea', 'newport', 'stoke-on-trent', 'sunderland',
  'ayrshire', 'east kilbride', 'paisley', 'kilmarnock',
]);

export function isUrbanCity(city: string): boolean {
  return URBAN_CITIES.has(city.toLowerCase().trim());
}

// ── Franchise / aggregator detection ─────────────────────────────────────────
// Brand-name suppression happens via prospect_filters (ignore_name_contains rows)
// at scout time. The audit cron also runs a deeper check by fetching the
// privacy policy and looking for franchise language — see detectFranchiseFromText
// below and the audit handler.

const FRANCHISE_INDICATORS = [
  /\bfranchis(?:e|ee|or|ing)\b/i,
  /\bmaster\s+franchise\b/i,
  /\bfranchise\s+agreement\b/i,
  /\boperated\s+under\s+licen[cs]e\b/i,
  /\bregistered\s+trade\s*mark\b/i,
];

// Scans free text (homepage / privacy policy body) for franchise indicators.
// Returns the matched phrase or null. Cheap regex pass — no allocation per call
// of consequence. Used by the audit cron's privacy-policy step.
export function detectFranchiseFromText(text: string): string | null {
  for (const re of FRANCHISE_INDICATORS) {
    const m = text.match(re);
    if (m) return m[0];
  }
  return null;
}

// ── Auto-locksmith focus classification ──────────────────────────────────────
// Strath targets AUTO locksmiths. Multi-category GBPs are fine (general
// locksmiths often advertise auto as a secondary service), so we score auto
// focus on the prospect data we *do* have: business name + which keyword
// surfaced the place.
//
// Confirmed = strongest evidence (name AND keyword). These go straight into
// outreach. Likely = single signal — still ingested as 'discovered'.
// Unknown = no auto signal — ingested as 'flagged' so Tyler can review without
// the record vanishing.

const AUTO_NAME_REGEX =
  /\b(auto|automotive|automobile|car\s*key|key\s*fob|transponder|ignition|vehicle\s*key|remote\s*program(?:ming)?|car\s*locks?|car\s*locksmith|auto\s*locksmith)\b/i;

export const AUTO_FOCUSED_KEYWORDS = [
  'auto locksmith',
  'car key',
  'car key locksmith',
  'automotive locksmith',
];

export function nameMatchesAutoLocksmith(name: string): boolean {
  return AUTO_NAME_REGEX.test(name);
}

export function classifyAutoFocus(
  name: string,
  discoveredViaAutoKeyword: boolean
): 'confirmed' | 'likely' | 'unknown' {
  const nameHit = nameMatchesAutoLocksmith(name);
  if (nameHit && discoveredViaAutoKeyword) return 'confirmed';
  if (nameHit || discoveredViaAutoKeyword)   return 'likely';
  return 'unknown';
}
