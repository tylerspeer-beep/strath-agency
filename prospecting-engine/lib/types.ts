// Strath Agency — Prospect Engine Types
// Shared across scout, audit, and sync modules.

// ─── CORE PROSPECT ───────────────────────────────────────────────────────────

export type EntityType = 'Ltd' | 'Sole Trader' | 'Partnership' | 'Unknown';
// 'ungraded' is the value set by the scout — audit cron assigns the real tier
export type IcpTier = 'A - Hot (70+)' | 'B - Warm (40-69)' | 'C - Cold (<40)' | 'ungraded';
export type WebsiteStatus = 'None' | 'Basic/Old' | 'Modern' | 'Optimised';
export type GbpStatus = 'Unclaimed' | 'Claimed - Basic' | 'Claimed - Optimised';
export type ProspectStatus =
  | 'discovered'
  | 'audited'
  | 'approved'
  | 'rejected'
  | 'flagged'
  | 'in_outreach'
  | 'responded'
  | 'closed_won'
  | 'closed_lost'
  | 'do_not_contact';

// GBP-first weights. Source of truth: SCORE_WEIGHTS in scoring.ts.
// Presence categories (reviews, gbp, website, phone) are surfaced in the prospect
// report; fit categories (urban, notFranchise) are internal ICP qualifiers.
// Entity is NOT scored — it is a compliance/contactability signal (WhatsApp/text
// eligibility under PECR), handled via isWhatsappEligible(), not this breakdown.
export interface ScoreBreakdown {
  reviews: number;      // max 30  (presence)
  gbp: number;          // max 25  (presence)
  website: number;      // max 12  (presence)
  phone: number;        // max 8   (presence — v1 contactability only)
  urban: number;        // max 8   (fit)
  notFranchise: number; // max 7   (fit)
  total: number;        // 0–100 (raw sum of the 6 categories, normalised from /90)
}

export interface Prospect {
  id?: string;
  createdAt?: Date;
  updatedAt?: Date;

  // Identity
  businessName: string;
  tradingName?: string;
  ownerName?: string;

  // Location
  city: string;
  region?: string;
  postcode?: string;
  fullAddress?: string;
  latitude?: number;
  longitude?: number;
  serviceArea?: string;

  // Contact
  phone?: string;
  email?: string;
  websiteUrl?: string;
  whatsappEligible?: boolean;

  // GBP
  googlePlaceId?: string;
  gbpName?: string;
  gbpRating?: number;
  gbpReviewCount?: number;
  gbpStatus?: GbpStatus;
  gbpUrl?: string;
  gbpTypeMismatch?: boolean; // true if GBP types[] doesn't include 'locksmith'
  gbpCategories?: string[]; // raw Places types[] e.g. ['locksmith','point_of_interest']

  // Places lifecycle
  // 'OPERATIONAL' | 'CLOSED_TEMPORARILY' | 'CLOSED_PERMANENTLY'
  // Scout hard-skips non-OPERATIONAL records; field stored for audit visibility.
  businessStatus?: string;

  // Auto-locksmith focus classification (set by scout)
  //   confirmed: name regex matches auto AND discovered via auto keyword
  //   likely:    one signal present
  //   unknown:   neither — status='flagged' for manual review
  autoFocus?: 'confirmed' | 'likely' | 'unknown';

  // How franchise_flag became true. 'filter_match' | 'name_pattern' | 'privacy_policy' | 'manual'
  franchiseDetectedBy?: string;

  // Why a record was marked status='do_not_contact'
  doNotContactReason?: string;

  // Entity
  entityType: EntityType;
  companiesHouseNumber?: string;
  companiesHouseName?: string;
  tpsCptpStatus?: string;

  // Website quality
  websiteStatus?: WebsiteStatus;
  hasSchema?: boolean;
  hasTitleTag?: boolean;
  titleTagQuality?: string;
  mobileOptimised?: boolean;
  hasH1?: boolean;
  hasFaq?: boolean;
  agencyWatermark?: string;
  franchiseFlag?: boolean;

  // ICP scoring
  // rawScore: set by scout from signal-count formula. icpScore: set by audit after full analysis.
  rawScore?: number;
  icpScore?: number;
  icpTier?: IcpTier;
  scoreBreakdown?: ScoreBreakdown;

  // Competitive intel
  nearestCompetitor?: string;
  observation1?: string;
  observation2?: string;

  // Dedup
  duplicateOfPlaceId?: string;  // place_id of the original when this was suppressed

  // GHL
  ghlContactId?: string;
  ghlOpportunityId?: string;
  ghlSyncedAt?: Date;
  outreachStage?: string;
  approvedForOutreach?: boolean;

  // Meta
  status?: ProspectStatus;
  source?: string;
  driveLogged?: boolean;
}

// ─── GOOGLE PLACES ───────────────────────────────────────────────────────────

export interface PlacesResult {
  place_id: string;
  name: string;
  formatted_address: string;
  geometry: {
    location: { lat: number; lng: number };
  };
  rating?: number;
  user_ratings_total?: number;
  website?: string;
  formatted_phone_number?: string;
  international_phone_number?: string;
  types?: string[];
  business_status?: string;
  opening_hours?: { open_now?: boolean };
  url?: string; // Google Maps URL / GBP link
}

// ─── COMPANIES HOUSE ─────────────────────────────────────────────────────────

export interface CompaniesHouseItem {
  company_number: string;
  title: string;
  company_type: string;
  company_status: string;
  date_of_creation?: string;
  address?: {
    address_line_1?: string;
    locality?: string;
    postal_code?: string;
  };
}

export interface CompaniesHouseSearchResult {
  items: CompaniesHouseItem[];
  total_results: number;
}

// ─── AUDIT ───────────────────────────────────────────────────────────────────

export interface WebsiteAuditResult {
  url: string;
  reachable: boolean;
  titleTag?: string;
  hasTitleTag: boolean;              // true if a non-empty title tag was found
  titleTagQuality: string;           // 'Missing' | 'Generic' | 'Good' | 'Optimised'
  metaDescription?: string;
  h1Tag?: string;
  hasH1: boolean;                    // true if a non-empty H1 was found
  hasSchema: boolean;
  schemaTypes: string[];
  hasFaqSection: boolean;
  mobileViewport: boolean;
  hasAddress: boolean;
  hasPhone: boolean;
  agencyWatermark?: string;
  websiteStatus: WebsiteStatus;
  aiVisibilityScore: number; // 0–10
  aiVisibilityNotes: string;
  rawHtmlSnapshot?: string;
}

export interface AuditResult {
  website: WebsiteAuditResult | null;
  gbpStatus: GbpStatus;
  gbpRating?: number;
  gbpReviewCount?: number;
  nearestCompetitor?: string;
  observation1: string;
  observation2: string;
}

// ─── GHL ─────────────────────────────────────────────────────────────────────

export interface GhlCustomField {
  id: string;
  value: string | number | string[];
}

export interface GhlContactPayload {
  firstName?: string;
  lastName?: string;
  name?: string;
  email?: string;
  phone?: string;
  companyName?: string;
  website?: string;
  address1?: string;
  city?: string;
  postalCode?: string;
  tags?: string[];
  customFields?: GhlCustomField[];
  source?: string;
}

export interface GhlOpportunityPayload {
  title: string;
  pipelineId: string;
  pipelineStageId: string;
  contactId: string;
  status?: string;
  monetaryValue?: number;
}

// ─── ENV ─────────────────────────────────────────────────────────────────────
// Expected environment variables (Vercel project settings)

export interface Env {
  NEON_DATABASE_URL: string;
  GOOGLE_PLACES_API_KEY: string;
  ANTHROPIC_API_KEY?: string;        // Claude Sonnet audit engine — falls back to rules-based if absent
  GHL_STRATH_OPS_PIT: string;       // Strath Agency Ops sub-account PIT
  GHL_STRATH_OPS_LOCATION_ID: string; // Wh5GIK1F7zKLfCiM55zh
  GHL_BASE_URL: string;              // https://services.leadconnectorhq.com
  COMPANIES_HOUSE_API_KEY?: string;  // Optional — free tier works without auth
  SCOUT_TARGET_CITIES?: string;      // Comma-separated: "Glasgow,Edinburgh,Aberdeen"
  SCOUT_KEYWORD?: string;            // Comma-separated: "locksmith,auto locksmith"
  CRON_SECRET: string;               // Protect cron endpoints
}
