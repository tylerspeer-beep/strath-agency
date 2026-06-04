// Strath Agency — ICP Scoring Library
// Formula source: prospect-scout-log.md
//
// Points breakdown (max 100):
//   Google Reviews:  <15 → 25pts | 15–40 → 15pts | 40+ → 5pts
//   Website:         None → 25pts | Basic/Old → 20pts | Modern → 10pts | Optimised → 2pts
//   GBP:             Unclaimed → 20pts | Claimed Basic → 15pts | Optimised → 5pts
//   Entity:          Ltd → 10pts | Sole Trader/Partnership/Unknown → 5pts
//   Urban/Suburban:  true → 10pts
//   Not Franchise:   true → 10pts
//
// Tiers: A = 70+, B = 40–69, C = <40

import type { ScoreBreakdown, IcpTier, WebsiteStatus, GbpStatus, EntityType } from './types.js';

export interface ScoringInputs {
  gbpReviewCount?: number;
  websiteStatus?: WebsiteStatus;
  gbpStatus?: GbpStatus;
  entityType?: EntityType;
  isUrban?: boolean;          // city population > ~50k = true
  franchiseFlag?: boolean;
}

export function scoreProspect(inputs: ScoringInputs): {
  score: number;
  tier: IcpTier;
  breakdown: ScoreBreakdown;
} {
  const breakdown: ScoreBreakdown = {
    reviews: 0,
    website: 0,
    gbp: 0,
    entity: 0,
    urban: 0,
    notFranchise: 0,
    total: 0,
  };

  // ── Google Reviews ──
  const reviews = inputs.gbpReviewCount ?? 0;
  if (reviews < 15)        breakdown.reviews = 25;
  else if (reviews <= 40)  breakdown.reviews = 15;
  else                     breakdown.reviews = 5;

  // ── Website ──
  switch (inputs.websiteStatus) {
    case 'None':        breakdown.website = 25; break;
    case 'Basic/Old':   breakdown.website = 20; break;
    case 'Modern':      breakdown.website = 10; break;
    case 'Optimised':   breakdown.website = 2;  break;
    default:            breakdown.website = 20; // unknown = treat as Basic/Old
  }

  // ── GBP ──
  switch (inputs.gbpStatus) {
    case 'Unclaimed':        breakdown.gbp = 20; break;
    case 'Claimed - Basic':  breakdown.gbp = 15; break;
    case 'Claimed - Optimised': breakdown.gbp = 5; break;
    default:                 breakdown.gbp = 15; // unknown = assume claimed basic
  }

  // ── Entity ──
  breakdown.entity = inputs.entityType === 'Ltd' ? 10 : 5;

  // ── Urban ──
  breakdown.urban = inputs.isUrban !== false ? 10 : 0;

  // ── Not Franchise ──
  breakdown.notFranchise = inputs.franchiseFlag ? 0 : 10;

  // ── Total ──
  breakdown.total =
    breakdown.reviews +
    breakdown.website +
    breakdown.gbp +
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
