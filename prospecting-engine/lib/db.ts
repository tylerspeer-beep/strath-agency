// Strath Agency — Neon DB Client
// Wraps @neondatabase/serverless for Vercel Edge/Node functions.
// Connection string resolution order:
//   1. NEON_DATABASE_URL (manually set, must be a valid postgres:// URL)
//   2. Constructed from NEON_DATABASE_PGUSER/PGPASSWORD/PGHOST/PGDATABASE

import { neon } from '@neondatabase/serverless';
import type { Prospect } from './types.js';

function buildConnectionUrl(): string {
    // Try the manually-set NEON_DATABASE_URL first (only if it looks like a real URL)
  const manualUrl = process.env.NEON_DATABASE_URL;
    if (manualUrl && manualUrl.startsWith('postgres')) {
          return manualUrl;
    }

  // Fall back to constructing from individual Neon integration vars
  const host = process.env.NEON_DATABASE_PGHOST;
    const user = process.env.NEON_DATABASE_PGUSER;
    const password = process.env.NEON_DATABASE_PGPASSWORD;
    const database = process.env.NEON_DATABASE_PGDATABASE;

  if (host && user && password && database) {
        return `postgresql://${user}:${encodeURIComponent(password)}@${host}/${database}?sslmode=require`;
  }

  throw new Error(
        'No valid Neon DB connection found. Set NEON_DATABASE_URL to a postgres:// URL, ' +
        'or ensure NEON_DATABASE_PGHOST/PGUSER/PGPASSWORD/PGDATABASE are set by the Neon integration.'
      );
}

function getDb() {
    const url = buildConnectionUrl();
    return neon(url);
}

// — Prospect queries ————————————————————————————————————

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
              google_place_id, name, address, city, phone, website,
                    google_rating, google_review_count, google_types,
                          icp_score, icp_tier, entity_type, status,
                                created_at, updated_at
                                    ) VALUES (
                                          ${p.google_place_id}, ${p.name}, ${p.address}, ${p.city},
                                                ${p.phone ?? null}, ${p.website ?? null},
                                                      ${p.google_rating ?? null}, ${p.google_review_count ?? 0},
                                                            ${JSON.stringify(p.google_types ?? [])},
                                                                  ${p.icp_score}, ${p.icp_tier}, ${p.entity_type ?? 'unknown'},
                                                                        'new', NOW(), NOW()
                                                                            )
                                                                                RETURNING id
                                                                                  `;
    return rows[0].id as string;
}

export async function updateProspectGhlIds(
    id: string,
    ghl_contact_id: string,
    ghl_location_id: string
  ): Promise<void> {
    const sql = getDb();
    await sql`
        UPDATE prospects
            SET ghl_contact_id = ${ghl_contact_id},
                    ghl_location_id = ${ghl_location_id},
                            updated_at = NOW()
                                WHERE id = ${id}
                                  `;
}

export async function updateProspectAudit(
    id: string,
    auditData: {
          website_status: string;
          has_schema: boolean;
          has_mobile: boolean;
          has_faq: boolean;
          page_title: string | null;
          meta_description: string | null;
          h1: string | null;
          ai_visibility_score: number;
          observation_1: string | null;
          observation_2: string | null;
          nearest_competitor: string | null;
          audit_score: number;
    }
  ): Promise<void> {
    const sql = getDb();
    await sql`
        UPDATE prospects
            SET website_status = ${auditData.website_status},
                    has_schema = ${auditData.has_schema},
                            has_mobile = ${auditData.has_mobile},
                                    has_faq = ${auditData.has_faq},
                                            page_title = ${auditData.page_title ?? null},
                                                    meta_description = ${auditData.meta_description ?? null},
                                                            h1 = ${auditData.h1 ?? null},
                                                                    ai_visibility_score = ${auditData.ai_visibility_score},
                                                                            observation_1 = ${auditData.observation_1 ?? null},
                                                                                    observation_2 = ${auditData.observation_2 ?? null},
                                                                                            nearest_competitor = ${auditData.nearest_competitor ?? null},
                                                                                                    audit_score = ${auditData.audit_score},
                                                                                                            status = 'audited',
                                                                                                                    updated_at = NOW()
                                                                                                                        WHERE id = ${id}
                                                                                                                          `;
}

export async function logScoutRun(
    city: string,
    places_found: number,
    prospects_new: number,
    tier_a: number,
    tier_b: number,
    tier_c: number,
    error_count: number
  ): Promise<void> {
    const sql = getDb();
    await sql`
        INSERT INTO scout_runs (
              city, places_found, prospects_new,
                    tier_a, tier_b, tier_c, error_count, ran_at
                        ) VALUES (
                              ${city}, ${places_found}, ${prospects_new},
                                    ${tier_a}, ${tier_b}, ${tier_c}, ${error_count}, NOW()
                                        )
                                          `;
}

export async function getProspectsPendingAudit(limit = 5): Promise<Prospect[]> {
    const sql = getDb();
    const rows = await sql`
        SELECT * FROM prospects
            WHERE status = 'new'
                  AND icp_tier IN ('A', 'B')
                      ORDER BY icp_score DESC
                          LIMIT ${limit}
                            `;
    return rows as Prospect[];
}
