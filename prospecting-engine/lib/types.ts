// Strath Agency — Prospect Engine Types
// Shared across scout, audit, and sync modules.

// ─── CORE PROSPECT ───────────────────────────────────────────────────────────

export type EntityType = 'Ltd' | 'Sole Trader' | 'Partnership' | 'Unknown';
export type IcpTier = 'A - Hot (70+)' | 'B - Warm (40-69)' | 'C - Cold (<40)';
export type WebsiteStatus = 'None' | 'Basic/Old' | 'Modern' | 'Optimised';
export type GbpStatus = 'Unclaimed' | 'Claimed - Basic' | 'Claimed - Optimised';
export type ProspectStatus =
  | 'discovered'
  | 'audited'
  | 'approved'
  | 'rejected'
  | 'in_outreach'
  | 'responded'
  | 'closed_won'
  | 'closed_lost'
  | 'do_not_contact';

export interface ScoreBreakdown {
  reviews: number;     // max 25
  website: number;     // max 25
  gbp: number;         // max 20
  entity: number;      // max 10
  urban: number;       // max 10
  notFranchise: number; // max 10
  total: number;       // max 100
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
  icpScore?: number;
  icpTier?: IcpTier;
  scoreBreakdown?: ScoreBreakdown;

  // Competitive intel
  nearestCompetitor?: string;
  observation1?: string;
  observation2?: string;

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
  metaDescription?: string;
  h1Tag?: string;
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
  GHL_STRATH_OPS_PIT: string;       // Strath Agency Ops sub-account PIT
  GHL_STRATH_OPS_LOCATION_ID: string; // Wh5GIK1F7zKLfCiM55zh
  GHL_BASE_URL: string;              // https://services.leadconnectorhq.com
  COMPANIES_HOUSE_API_KEY?: string;  // Optional — free tier works without auth
  SCOUT_TARGET_CITIES?: string;      // Comma-separated: "Glasgow,Edinburgh,Aberdeen"
  CRON_SECRET: string;               // Protect cron endpoints
}
