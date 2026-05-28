// Strath Agency — Neon DB Client
// Wraps @neondatabase/serverless for Vercel Edge/Node functions.
// Connection string resolution order:
//   1. NEON_DATABASE_URL (manually set, must be a valid postgres:// URL)
//   2. Constructed from NEON_DATABASE_PGUSER/PGPASSWORD/PGHOST/PGDATABASE

import { neon } from '@neondatabase/serverless';
import type { Prospect } from './types.js';

function buildConnectionUrl(): string {
        const manualUrl = process.env.NEON_DATABASE_URL;
        if (manualUrl && manualUrl.startsWith('postgres')) {
                    return manualUrl;
        }
        const host = process.env.NEON_DATABASE_PGHOST;
        const user = process.env.NEON_DATABASE_PGUSER;
        const password = process.env.NEON_DATABASE_PGPASSWORD;
        const database = process.env.NEON_DATABASE_PGDATABASE;
        if (host && user && password && database) {
                    return `postgresql://${user}:${encodeURIComponent(password)}@${host}/${database}?sslmode=require`;
        }
        throw new Error('No valid Neon DB connection found. Set NEON_DATABASE_URL to a postgres:// URL.');
}

export function getDb() {
        return neon(buildConnectionUrl());
}

export async function findProspectByPlaceId(placeId: string): Promise<{ id: string } | null> {
        const sql = getDb();
        const rows = await sql`SELECT id FROM prospects WHERE google_place_id = ${placeId} LIMIT 1`;
        return rows[0] as { id: string } | null;
}

export async function findProspectByPhone(phone: string): Promise<{ id: string } | null> {
        const sql = getDb();
        const rows = await sql`SELECT id FROM prospects WHERE phone = ${phone} LIMIT 1`;
        return rows[0] as { id: string } | null;
}

export async function insertProspect(p: Prospect): Promise<string> {
        const sql = getDb();
        const rows = await sql`
                INSERT INTO prospects (
                            google_place_id, business_name, full_address, city, phone, website_url,
                                        gbp_name, gbp_rating, gbp_review_count, gbp_status, gbp_url,
                                                    entity_type, companies_house_number, website_status, franchise_flag,
                                                                icp_score, icp_tier, score_breakdown, status, source, created_at, updated_at
                                                                        ) VALUES (
                                                                                    ${p.googlePlaceId ?? null}, ${p.businessName}, ${p.fullAddress ?? null},
                                                                                                ${p.city}, ${p.phone ?? null}, ${p.websiteUrl ?? null},
                                                                                                            ${p.gbpName ?? null}, ${p.gbpRating ?? null}, ${p.gbpReviewCount ?? null},
                                                                                                                        ${p.gbpStatus ?? null}, ${p.gbpUrl ?? null},
                                                                                                                                    ${p.entityType ?? 'Unknown'}, ${p.companiesHouseNumber ?? null},
                                                                                                                                                ${p.websiteStatus ?? null}, ${p.franchiseFlag ?? false},
                                                                                                                                                            ${p.icpScore ?? null}, ${p.icpTier ?? null},
                                                                                                                                                                        ${JSON.stringify(p.scoreBreakdown ?? {})},
                                                                                                                                                                                    ${p.status ?? 'discovered'}, ${p.source ?? 'google_places'},
                                                                                                                                                                                                NOW(), NOW()
                                                                                                                                                                                                        )
                                                                                                                                                                                                                RETURNING id`;
        return rows[0].id as string;
}

export async function updateProspectGhlIds(id: string, ghl_contact_id: string, ghl_location_id: string): Promise<void> {
        const sql = getDb();
        await sql`UPDATE prospects SET ghl_contact_id = ${ghl_contact_id}, ghl_synced_at = NOW(), updated_at = NOW() WHERE id = ${id}`;
}

export async function updateProspectAudit(id: string, auditData: { website_status: string; has_schema: boolean; has_mobile: boolean; has_faq: boolean; page_title: string | null; meta_description: string | null; h1: string | null; ai_visibility_score: number; observation_1: string | null; observation_2: string | null; nearest_competitor: string | null; audit_score: number; }): Promise<void> {
        const sql = getDb();
        await sql`UPDATE prospects SET website_status = ${auditData.website_status}, has_schema = ${auditData.has_schema}, has_mobile = ${auditData.has_mobile}, has_faq = ${auditData.has_faq}, page_title = ${auditData.page_title ?? null}, meta_description = ${auditData.meta_description ?? null}, h1 = ${auditData.h1 ?? null}, ai_visibility_score = ${auditData.ai_visibility_score}, observation_1 = ${auditData.observation_1 ?? null}, observation_2 = ${auditData.observation_2 ?? null}, nearest_competitor = ${auditData.nearest_competitor ?? null}, updated_at = NOW() WHERE id = ${id}`;
}

export async function logScoutRun(city: string, places_found: number, prospects_new: number, tier_a: number, tier_b: number, tier_c: number, error_count: number): Promise<void> {
        const sql = getDb();
        await sql`INSERT INTO scout_runs (city, places_found, prospects_new, tier_a, tier_b, tier_c, error_count, ran_at) VALUES (${city}, ${places_found}, ${prospects_new}, ${tier_a}, ${tier_b}, ${tier_c}, ${error_count}, NOW())`;
}

export async function getProspectsPendingAudit(limit = 5): Promise<Prospect[]> {
        const sql = getDb();
        const rows = await sql`SELECT * FROM prospects WHERE status = 'discovered' AND icp_tier IN ('A - Hot (70+)', 'B - Warm (40-69)') ORDER BY icp_score DESC LIMIT ${limit}`;
        return rows as Prospect[];
}
