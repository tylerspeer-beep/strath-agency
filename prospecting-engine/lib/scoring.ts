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

// ── Franchise flag ────────────────────────────────────────────────────────────
// Flags aggregators and national chains — these are NOT ICPs.

const FRANCHISE_KEYWORDS = [
  'checkatrade', 'rated people', 'yell', 'bark.com', 'mybuilder',
  'aaa', 'pop-a-lock', 'locksmith network', 'fast locksmith',
  'emergency locksmith ltd', '24/7 locksmiths', 'local locksmith',
  'nationwide', 'uk locksmiths', 'british locksmith',
];

export function detectFranchise(businessName: string, websiteUrl?: string): boolean {
  const lower = businessName.toLowerCase();
  const urlLower = (websiteUrl ?? '').toLowerCase();
  return FRANCHISE_KEYWORDS.some(kw => lower.includes(kw) || urlLower.includes(kw));
}
