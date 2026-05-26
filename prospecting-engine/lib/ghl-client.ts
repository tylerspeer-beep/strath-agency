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
// Custom field IDs (Strath Ops — as of 23 May 2026):
//   Outreach Stage:       73BozTdNQufntQ3mKc3K
//   Sequence Status:      phOmcu3qbJalYhRADv0m
//   Response Date:        RRbuIn56ETycAwmkM0zT
//   Observation 1:        (fieldKey: contact.observation_1)
//   Observation 2:        (fieldKey: contact.observation_2)
//   Nearest Competitor:   (fieldKey: contact.nearest_competitor)
//   Entity Type:          (fieldKey: contact.entity_type)
//   ICP Score:            (fieldKey: contact.icp_score)
//   ICP Tier:             (fieldKey: contact.icp_tier)
//   Website Status:       (fieldKey: contact.website_status)
//   GBP Status:           (fieldKey: contact.gbp_status)
//   GBP Rating:           (fieldKey: contact.google_review_rating) -- uses template field key
//   GBP Review Count:     (fieldKey: contact.google_review_count)
//   Companies House No:   (fieldKey: contact.companies_house_number)

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
  FIELD_KEYS: {
    outreachStage:        'contact.outreach_stage',
    sequenceStatus:       'contact.sequence_status',
    responseDate:         'contact.response_date',
    observation1:         'contact.observation_1',
    observation2:         'contact.observation_2',
    nearestCompetitor:    'contact.nearest_competitor',
    entityType:           'contact.entity_type',
    icpScore:             'contact.icp_score',
    icpTier:              'contact.icp_tier',
    websiteStatus:        'contact.website_status',
    gbpStatus:            'contact.gbp_status',
    gbpRating:            'contact.google_review_rating',
    gbpReviewCount:       'contact.google_review_count',
    companiesHouseNumber: 'contact.companies_house_number',
    businessTradeType:    'contact.business_trade_type',
    serviceArea:          'contact.service_area',
    whatsappEligible:     'contact.whatsapp_eligible',
    tpsCptpStatus:        'contact.tps_ctps_status',
    sourceCity:           'contact.location_city',
    ghlSubAccountId:      'contact.ghl_subaccount_id',
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
  async upsertContact(payload: {
    name?: string;
    email?: string;
    phone?: string;
    companyName?: string;
    website?: string;
    city?: string;
    tags?: string[];
    customFields?: Array<{ key: string; field_value: string | number }>;
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
  async createOpportunity(payload: {
    title: string;
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
    customFields: Array<{ key: string; field_value: string | number }>
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
}): Array<{ key: string; field_value: string | number }> {
  const fields: Array<{ key: string; field_value: string | number }> = [];

  const add = (key: string, value: string | number | undefined | null) => {
    if (value !== undefined && value !== null && value !== '') {
      fields.push({ key, field_value: value });
    }
  };

  add(GHL.FIELD_KEYS.icpScore, p.icpScore);
  add(GHL.FIELD_KEYS.icpTier, p.icpTier);
  add(GHL.FIELD_KEYS.websiteStatus, p.websiteStatus);
  add(GHL.FIELD_KEYS.gbpStatus, p.gbpStatus);
  add(GHL.FIELD_KEYS.gbpRating, p.gbpRating);
  add(GHL.FIELD_KEYS.gbpReviewCount, p.gbpReviewCount);
  add(GHL.FIELD_KEYS.entityType, p.entityType);
  add(GHL.FIELD_KEYS.companiesHouseNumber, p.companiesHouseNumber);
  add(GHL.FIELD_KEYS.observation1, p.observation1);
  add(GHL.FIELD_KEYS.observation2, p.observation2);
  add(GHL.FIELD_KEYS.nearestCompetitor, p.nearestCompetitor);
  add(GHL.FIELD_KEYS.sourceCity, p.city);
  add(GHL.FIELD_KEYS.outreachStage, p.outreachStage ?? 'Not Contacted');

  return fields;
}
