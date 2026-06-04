// Strath Agency — GHL API Client (direct REST, for Vercel functions)
// This is NOT the MCP server — it's a lightweight HTTP client for Vercel cron jobs.
// Uses Strath Agency Ops sub-account credentials.
//
// Key IDs (Strath Ops):
//   Location ID:   Wh5GIK1F7zKLfCiM55zh
//   Pipeline ID:   I7FwEILwbdXkvyK4ak6q
//
// Pipeline stage IDs:
//   Identified:       e8259805-5432-4e03-b82e-c435ba4f6206
//   Assessed:         a5a0fbc5-123e-4d58-83e9-514ac8e7339e
//   Outreach Active:  a54f2ad6-b340-4bc8-b882-fceee44c351b
//   Responded:        10756f0b-f0ab-4036-8fb1-51bdd03ce938
//   Pitched:          b5b4fe85-5b38-488f-969a-e5b30c4df293
//   Sold:             26313281-1d1b-417a-8194-9af5d778a9ff
//   Build In Progress: cc951293-345e-472f-8d80-00a651ae1862
//   Live:             b5cf69be-cd4f-40c1-b3d1-ae9ada10133e
//   Retained:         54dc4fe1-db34-486c-8726-18c2bdd8f6e2
//   Lost:             50b69fc3-a005-4b47-b459-ace2a37fefde
//
// Custom field keys (Strath Ops — verified 1 Jun 2026 against live GHL data):
//   All keys confirmed by calling GET /locations/{id}/customFields.
//   Fixed in Session 2: gbpRating, gbpReviewCount, sourceCity were all wrong.
//
// MANUAL CREATION REQUIRED (GHL UI only — CHECKBOX fields):
//   Has FAQ:              contact.has_faq           (Settings → Custom Fields → Add → Checkbox)
//   Do Not Contact Flag:  contact.do_not_contact_flag
//   GBP Type Mismatch:    contact.gbp_type_mismatch
//   Report CTA Clicked:   contact.report_cta_clicked

export const GHL = {
  LOCATION_ID: 'Wh5GIK1F7zKLfCiM55zh',
  PIPELINE_ID: 'I7FwEILwbdXkvyK4ak6q',
  STAGES: {
    identified:       'e8259805-5432-4e03-b82e-c435ba4f6206',
    assessed:         'a5a0fbc5-123e-4d58-83e9-514ac8e7339e',
    outreachActive:   'a54f2ad6-b340-4bc8-b882-fceee44c351b',
    responded:        '10756f0b-f0ab-4036-8fb1-51bdd03ce938',
    pitched:          'b5b4fe85-5b38-488f-969a-e5b30c4df293',
    sold:             '26313281-1d1b-417a-8194-9af5d778a9ff',
    buildInProgress:  'cc951293-345e-472f-8d80-00a651ae1862',
    live:             'b5cf69be-cd4f-40c1-b3d1-ae9ada10133e',
    retained:         '54dc4fe1-db34-486c-8726-18c2bdd8f6e2',
    lost:             '50b69fc3-a005-4b47-b459-ace2a37fefde',
  },
  // FIELD_KEYS kept for reference only — GHL contact PUT requires field UUIDs (FIELD_IDS), not key strings.
  // GHL silently ignores key-format entries and returns 200. Always use FIELD_IDS for writes.
  FIELD_KEYS: {
    // ── Outreach tracking ───────────────────────────────────────────────────
    outreachStage:        'contact.outreach_stage',
    sequenceStatus:       'contact.sequence_status',
    responseDate:         'contact.response_date',
    whatsappEligible:     'contact.whatsapp_eligible',

    // ── Audit outputs ────────────────────────────────────────────────────────
    observation1:         'contact.observation_1',
    observation2:         'contact.observation_2',
    nearestCompetitor:    'contact.nearest_competitor',
    outreachHook:         'contact.outreach_hook',
    quickWins:            'contact.quick_wins',
    aiVisibilityScore:    'contact.ai_visibility_score',

    // ── ICP scoring ──────────────────────────────────────────────────────────
    rawScore:             'contact.raw_score',
    icpScore:             'contact.icp_score',
    icpTier:              'contact.icp_tier',

    // ── Entity / compliance ──────────────────────────────────────────────────
    entityType:           'contact.entity_type',
    companiesHouseNumber: 'contact.companies_house_number',
    tpsCptpStatus:        'contact.tpsctps_status',

    // ── Website quality ──────────────────────────────────────────────────────
    websiteStatus:        'contact.website_status',
    hasSchema:            'contact.has_schema',
    mobileOptimised:      'contact.mobile_optimised',

    // ── GBP ─────────────────────────────────────────────────────────────────
    gbpStatus:            'contact.gbp_status',
    gbpRating:            'contact.gbp_rating',
    gbpReviewCount:       'contact.gbp_review_count',

    // ── Business profile ─────────────────────────────────────────────────────
    businessTradeType:    'contact.business_trade_type',
    serviceArea:          'contact.service_area',
    sourceCity:           'contact.locationcity',
    titleTagQuality:      'contact.title_tag_quality',
    agencyWatermark:      'contact.agency_watermark',
    franchiseFlag:        'contact.franchise_flag',

    // ── Do not contact ───────────────────────────────────────────────────────
    doNotContactReason:   'contact.do_not_contact_reason',

    // ── Report tracking ──────────────────────────────────────────────────────
    reportUrl:                  'contact.report_url',
    reportFirstOpenedAt:        'contact.report_first_opened_at',
    reportLastOpenedAt:         'contact.report_last_opened_at',
    reportOpenCount:            'contact.report_open_count',
    reportSectionsViewed:       'contact.report_sections_viewed',
    reportTimeOnPageSeconds:    'contact.report_time_on_page_seconds',

    // ── Client management ────────────────────────────────────────────────────
    ghlSubAccountId:      'contact.ghl_subaccount_id',
  },
  // Field UUIDs — verified 3 Jun 2026 via GET /locations/{id}/customFields.
  // Use these (not FIELD_KEYS) when writing to GHL via PUT /contacts/{id}.
  FIELD_IDS: {
    // ── Outreach tracking ───────────────────────────────────────────────────
    outreachStage:        '73BozTdNQufntQ3mKc3K',
    sequenceStatus:       'phOmcu3qbJalYhRADv0m',
    responseDate:         'RRbuIn56ETycAwmkM0zT',
    whatsappEligible:     's9lNKRXq6aVdriqzVxlP',

    // ── Audit outputs ────────────────────────────────────────────────────────
    observation1:         'Sk7axtnOCvX6VbXrS5wd',
    observation2:         '3leJlcPxoJHXQgPjKFdG',
    nearestCompetitor:    'M2afIWxwYDplAJdiIruy',
    outreachHook:         'eXygrVk5rgA0KNXaoBlq',
    quickWins:            '8DfXT55RQanwJSpvNpt0',
    aiVisibilityScore:    'VvQ9s0ihgKFEfCIIX23F',

    // ── ICP scoring ──────────────────────────────────────────────────────────
    rawScore:             'Gx7hANQPUcpghuAJqjAG',
    icpScore:             'KtdGRo2H6AkJ2SYyAbpR',
    icpTier:              'KbxizRTDaK1oRn3TRDJG',

    // ── Entity / compliance ──────────────────────────────────────────────────
    entityType:           'lyr2gHTjCnuponJg0v7d',
    companiesHouseNumber: 'pONs3R8HVubJaA9MxxF7',
    tpsCptpStatus:        'raYtYCN6warnhmGwJMRJ',

    // ── Website quality ──────────────────────────────────────────────────────
    websiteStatus:        'czraIs6sKMNpYeOSBjdA',
    hasSchema:            'KeZ2bl3VVckbJRLGApBs',
    mobileOptimised:      'w0GNCjAB0SvcN98mN0Aw',

    // ── GBP ─────────────────────────────────────────────────────────────────
    gbpStatus:            'ifLfK1GLLFU07ZTBrqLW',
    gbpRating:            'e8nu4c1NorvLiN8PVfVI',
    gbpReviewCount:       'ucy9Pr5x4FEO398DcTuJ',

    // ── Business profile ─────────────────────────────────────────────────────
    businessTradeType:    'vkYInfQdnyDDgoZ48VoL',
    sourceCity:           'xeu7RsNrRcliZFRdMPMU',
    titleTagQuality:      '8m3XTkuxQJclZnZV4nUQ',
    agencyWatermark:      'RvWaAU7LTaUElVBVtrjz',
    franchiseFlag:        'KsnUXZd5a474Q2BAsln5',

    // ── Do not contact ───────────────────────────────────────────────────────
    doNotContactReason:   'ni2IQLKx5FVE9GV51KaI',

    // ── Report tracking ──────────────────────────────────────────────────────
    reportUrl:                  'c6JtF7wICYmqwQdApYgV',
    reportFirstOpenedAt:        'wtEdzyqquMh5nf1uUBI7',
    reportLastOpenedAt:         'HBSvO8jZ1OIUEaCZRv99',
    reportOpenCount:            '8jabUZ3jtnBSnPi8lA6W',
    reportSectionsViewed:       'Oft0VvnvXzHpjutMUqSi',
    reportTimeOnPageSeconds:    'NOH0M0vs860XXylQm1wv',

    // ── Client management ────────────────────────────────────────────────────
    ghlSubAccountId:      'q2NZETtXLJT322J6SmAM',

    // ── Business identity ────────────────────────────────────────────────────
    businessName:         '3vWZA0tSQhEggH7ZFOrJ',
    websiteUrl:           'TRQsiMWEr1Vz3ojOZ1Fp',
    gbpUrl:               'ov8L8hJ9z9sn7sR6acec',
  },
  // Tags applied by the scout
  TAGS: {
    tierA: 'tier-a',
    tierB: 'tier-b',
    tierC: 'tier-c',
    coldOutreach: 'cold-outreach',
    doNotContact: 'do-not-contact',
  },
} as const;

// ── GHL API client ────────────────────────────────────────────────────────────

export class GhlClient {
  private baseUrl: string;
  private pit: string; // Private Integration Token
  private locationId: string;

  constructor(pit: string, locationId: string, baseUrl = 'https://services.leadconnectorhq.com') {
    this.pit = pit;
    this.locationId = locationId;
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    method: string,
    path: string,
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${this.pit}`,
        'Content-Type': 'application/json',
        'Version': '2021-07-28',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`GHL API ${method} ${path} → ${res.status}: ${text}`);
    }

    return res.json() as Promise<T>;
  }

  // ── Search for existing contact by phone or email ──────────────────────────
  async findContact(query: string): Promise<{ id: string } | null> {
    try {
      const data = await this.request<{ contacts: { id: string }[] }>(
        'GET',
        `/contacts/?locationId=${this.locationId}&query=${encodeURIComponent(query)}&limit=1`
      );
      return data.contacts?.[0] ?? null;
    } catch {
      return null;
    }
  }

  // ── Create or update a contact ─────────────────────────────────────────────
  // customFields uses `id` (field UUID), not `key`. GHL silently ignores key-format
  // entries on this endpoint — see Session 2 Bug #5 in SESSION_2_DEBRIEF.md.
  async upsertContact(payload: {
    name?: string;
    email?: string;
    phone?: string;
    companyName?: string;
    website?: string;
    city?: string;
    tags?: string[];
    customFields?: Array<{ id: string; field_value: string | number }>;
  }): Promise<string> {
    const body = {
      locationId: this.locationId,
      ...payload,
    };

    const data = await this.request<{ contact: { id: string } }>(
      'POST',
      '/contacts/upsert',
      body
    );
    return data.contact.id;
  }

  // ── Create opportunity in pipeline ─────────────────────────────────────────
  // GHL API requires 'name' not 'title' for the opportunity name field.
  async createOpportunity(payload: {
    name: string;
    pipelineId: string;
    pipelineStageId: string;
    contactId: string;
    status?: string;
  }): Promise<string> {
    const body = {
      locationId: this.locationId,
      ...payload,
    };

    const data = await this.request<{ opportunity: { id: string } }>(
      'POST',
      '/opportunities/',
      body
    );
    return data.opportunity.id;
  }

  // ── Add tags to contact ────────────────────────────────────────────────────
  async addTags(contactId: string, tags: string[]): Promise<void> {
    await this.request(
      'POST',
      `/contacts/${contactId}/tags`,
      { tags }
    );
  }

  // ── Update contact custom fields ───────────────────────────────────────────
  async updateContactFields(
    contactId: string,
    customFields: Array<{ id: string; field_value: string | number }>
  ): Promise<void> {
    await this.request(
      'PUT',
      `/contacts/${contactId}`,
      { customFields }
    );
  }
}

// ── Factory from env ──────────────────────────────────────────────────────────

export function createGhlClient(): GhlClient {
  const pit = process.env.GHL_STRATH_OPS_PIT;
  const locationId = process.env.GHL_STRATH_OPS_LOCATION_ID ?? GHL.LOCATION_ID;
  const baseUrl = process.env.GHL_BASE_URL ?? 'https://services.leadconnectorhq.com';

  if (!pit) throw new Error('GHL_STRATH_OPS_PIT env var is not set');
  return new GhlClient(pit, locationId, baseUrl);
}

// ── Build custom fields array for a prospect ──────────────────────────────────

// ── Scout-time fields (pushed at discovery, before audit) ────────────────────
export function buildScoutCustomFields(p: {
  rawScore?: number;
  icpTier?: string;
  websiteStatus?: string;
  gbpStatus?: string;
  gbpRating?: number;
  gbpReviewCount?: number;
  gbpUrl?: string;
  entityType?: string;
  companiesHouseNumber?: string;
  city?: string;
  outreachStage?: string;
  titleTagQuality?: string;
  businessName?: string;
  websiteUrl?: string;
}): Array<{ id: string; field_value: string | number }> {
  const fields: Array<{ id: string; field_value: string | number }> = [];

  const add = (id: string, value: string | number | undefined | null) => {
    if (value !== undefined && value !== null && value !== '') {
      fields.push({ id, field_value: value });
    }
  };

  add(GHL.FIELD_IDS.rawScore, p.rawScore);
  add(GHL.FIELD_IDS.icpTier, p.icpTier ?? 'Pending Audit');
  add(GHL.FIELD_IDS.websiteStatus, p.websiteStatus);
  add(GHL.FIELD_IDS.gbpStatus, p.gbpStatus);
  add(GHL.FIELD_IDS.gbpRating, p.gbpRating);
  add(GHL.FIELD_IDS.gbpReviewCount, p.gbpReviewCount);
  add(GHL.FIELD_IDS.gbpUrl, p.gbpUrl);
  add(GHL.FIELD_IDS.entityType, p.entityType);
  add(GHL.FIELD_IDS.companiesHouseNumber, p.companiesHouseNumber);
  add(GHL.FIELD_IDS.sourceCity, p.city);
  add(GHL.FIELD_IDS.outreachStage, p.outreachStage ?? 'Not Contacted');
  add(GHL.FIELD_IDS.titleTagQuality, p.titleTagQuality);
  add(GHL.FIELD_IDS.businessName, p.businessName);
  add(GHL.FIELD_IDS.websiteUrl, p.websiteUrl);

  return fields;
}

// ── Audit-time fields (pushed after Claude audit completes) ──────────────────
export function buildAuditCustomFields(p: {
  icpScore?: number;
  icpTier?: string;
  websiteStatus?: string;
  gbpStatus?: string;
  gbpRating?: number;
  gbpReviewCount?: number;
  gbpUrl?: string;
  entityType?: string;
  companiesHouseNumber?: string;
  businessName?: string;
  websiteUrl?: string;
  observation1?: string;
  observation2?: string;
  nearestCompetitor?: string;
  outreachHook?: string;
  quickWins?: string;
  aiVisibilityScore?: number;
  titleTagQuality?: string;
  reportUrl?: string;
}): Array<{ id: string; field_value: string | number }> {
  const fields: Array<{ id: string; field_value: string | number }> = [];

  const add = (id: string, value: string | number | undefined | null) => {
    if (value !== undefined && value !== null && value !== '') {
      fields.push({ id, field_value: value });
    }
  };

  add(GHL.FIELD_IDS.icpScore, p.icpScore);
  add(GHL.FIELD_IDS.icpTier, p.icpTier);
  add(GHL.FIELD_IDS.websiteStatus, p.websiteStatus);
  add(GHL.FIELD_IDS.gbpStatus, p.gbpStatus);
  add(GHL.FIELD_IDS.gbpRating, p.gbpRating);
  add(GHL.FIELD_IDS.gbpReviewCount, p.gbpReviewCount);
  add(GHL.FIELD_IDS.gbpUrl, p.gbpUrl);
  add(GHL.FIELD_IDS.entityType, p.entityType);
  add(GHL.FIELD_IDS.companiesHouseNumber, p.companiesHouseNumber);
  add(GHL.FIELD_IDS.businessName, p.businessName);
  add(GHL.FIELD_IDS.websiteUrl, p.websiteUrl);
  add(GHL.FIELD_IDS.observation1, p.observation1);
  add(GHL.FIELD_IDS.observation2, p.observation2);
  add(GHL.FIELD_IDS.nearestCompetitor, p.nearestCompetitor);
  add(GHL.FIELD_IDS.outreachHook, p.outreachHook);
  add(GHL.FIELD_IDS.quickWins, p.quickWins);
  add(GHL.FIELD_IDS.aiVisibilityScore, p.aiVisibilityScore);
  add(GHL.FIELD_IDS.titleTagQuality, p.titleTagQuality);
  add(GHL.FIELD_IDS.reportUrl, p.reportUrl);

  return fields;
}

// ── Legacy alias — scout used this name. Kept for backwards compat. ──────────
/** @deprecated Use buildScoutCustomFields instead */
export function buildProspectCustomFields(p: {
  icpScore?: number;
  icpTier?: string;
  websiteStatus?: string;
  gbpStatus?: string;
  gbpRating?: number;
  gbpReviewCount?: number;
  entityType?: string;
  companiesHouseNumber?: string;
  observation1?: string;
  observation2?: string;
  nearestCompetitor?: string;
  city?: string;
  outreachStage?: string;
}): Array<{ id: string; field_value: string | number }> {
  return buildScoutCustomFields({
    rawScore: p.icpScore, // best approximation before rawScore existed
    icpTier: p.icpTier,
    websiteStatus: p.websiteStatus,
    gbpStatus: p.gbpStatus,
    gbpRating: p.gbpRating,
    gbpReviewCount: p.gbpReviewCount,
    entityType: p.entityType,
    companiesHouseNumber: p.companiesHouseNumber,
    city: p.city,
    outreachStage: p.outreachStage,
  });
}
