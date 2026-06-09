// Strath Agency — Prospect Scout Cron
// Vercel cron function: runs on schedule (configured in vercel.json)
// Route: /api/prospect-scout
//
// What it does:
//   1. Picks the next city from SCOUT_TARGET_CITIES env var (round-robin)
//   2. Calls Google Places Nearby Search for the configured keyword in that city
//   3. Fetches full Place Details for each result (phone, website, etc.)
//   4. Checks prospect_filters — suppresses or flags matching prospects
//   5. Deduplicates by place_id, normalized phone, and root domain
//   6. Runs Companies House entity lookup
//   7. Scores each prospect with ICP formula — stores raw_score, sets icp_tier = 'ungraded'
//   8. Saves new prospects to Neon DB
//   9. Pushes prospects with raw_score >= 40 to GHL Strath Ops as a contact only
//      (icp_tier = 'Pending Audit', outreach_stage = 'Not Contacted')
//      GHL opportunity is NOT created here — audit cron creates it after tier is confirmed.
//  10. Logs the run to scout_runs table (including search_keyword used)
//
// Keyword configuration:
//   Default: 'locksmith'
//   Override per-run: POST/GET with ?keyword=auto+locksmith
//   Override globally: SCOUT_KEYWORD env var
//   Future: multiple keywords per run via schedule config
//
// Trigger: Vercel cron (see vercel.json) OR manual POST with CRON_SECRET header
// Protected: Authorization: Bearer {CRON_SECRET}

import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  scoreProspect,
  classifyWebsiteStatus,
  classifyGbpStatus,
  isUrbanCity,
  classifyAutoFocus,
  AUTO_FOCUSED_KEYWORDS,
} from '../lib/scoring.js';
import { resolveEntity } from '../lib/companies-house.js';
import {
  createGhlClient,
  GHL,
  buildScoutCustomFields,
} from '../lib/ghl-client.js';
import {
  findProspectByPlaceId,
  findProspectByPhone,
  findProspectByDomain,
  checkProspectFilters,
  insertProspect,
  updateProspectGhlIds,
  logScoutRun,
  normalizePhone,
  extractRootDomain,
} from '../lib/db.js';
import type { Prospect, PlacesResult } from '../lib/types.js';

const PLACES_BASE = 'https://maps.googleapis.com/maps/api/place';

// GHL push threshold: prospects at or above this raw_score get a contact created.
// Opportunity creation is deferred to the audit cron after tier confirmation.
const GHL_PUSH_RAW_SCORE_THRESHOLD = 40;

// ── Keyword resolution ────────────────────────────────────────────────────────
// Priority: query param > env var > default
// Returns comma-separated string → array (e.g. "locksmith,auto locksmith" → ['locksmith','auto locksmith'])
// The type=locksmith search is ALWAYS run regardless of keywords — merged separately.

// Strath focus: AUTO locksmiths. Default keywords lean automotive so the
// Places keyword search surfaces auto-focused businesses. The type=locksmith
// pass below catches everything else for ICP review.
function resolveKeywords(req: VercelRequest): string[] {
  const raw =
    (req.query.keyword && typeof req.query.keyword === 'string')
      ? req.query.keyword
      : process.env.SCOUT_KEYWORD ?? AUTO_FOCUSED_KEYWORDS.join(',');
  return raw.split(',').map(k => k.trim()).filter(Boolean);
}

// True if the keyword string contains an auto-focused token.
function isAutoKeyword(keyword: string): boolean {
  const k = keyword.toLowerCase();
  return /\b(auto|automotive|car\s*key|vehicle|transponder)\b/.test(k);
}

// ── City list ─────────────────────────────────────────────────────────────────
// Loaded from env or defaulted. Each run processes ONE city and rotates.

function getCityList(): string[] {
  const envCities = process.env.SCOUT_TARGET_CITIES;
  if (envCities) return envCities.split(',').map(c => c.trim()).filter(Boolean);
  return [
    'Glasgow', 'Edinburgh', 'Aberdeen', 'Dundee', 'Inverness',
    'Stirling', 'Falkirk', 'Hamilton', 'Livingston', 'Perth',
    'Paisley', 'Kilmarnock', 'East Kilbride',
  ];
}

// Simple round-robin city selection using the current hour as seed.
// This means each hourly cron run hits a different city.
function getTargetCity(): string {
  const cities = getCityList();
  const index = Math.floor(Date.now() / 3_600_000) % cities.length;
  return cities[index];
}

// ── Google Places helpers ─────────────────────────────────────────────────────

async function geocodeCity(city: string, apiKey: string): Promise<{ lat: number; lng: number } | null> {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(city + ', UK')}&key=${apiKey}`;
  const res = await fetch(url);
  const data = (await res.json()) as { results: { geometry: { location: { lat: number; lng: number } } }[]; status: string };
  if (data.status !== 'OK' || !data.results[0]) return null;
  return data.results[0].geometry.location;
}

// Paginated Nearby Search — 10km radius. Mode switches between keyword= and type=.
async function nearbySearch(
  lat: number,
  lng: number,
  apiKey: string,
  mode: { kind: 'keyword'; keyword: string } | { kind: 'type'; type: string }
): Promise<PlacesResult[]> {
  const baseParams =
    `?location=${lat},${lng}` +
    `&radius=10000` +
    (mode.kind === 'keyword'
      ? `&keyword=${encodeURIComponent(mode.keyword)}`
      : `&type=${encodeURIComponent(mode.type)}`) +
    `&key=${apiKey}`;

  const url = `${PLACES_BASE}/nearbysearch/json${baseParams}`;
  const results: PlacesResult[] = [];
  let nextPageToken: string | undefined;

  for (let page = 0; page < 3; page++) { // max 3 pages = 60 results
    const pageUrl = nextPageToken
      ? `${PLACES_BASE}/nearbysearch/json?pagetoken=${nextPageToken}&key=${apiKey}`
      : url;

    const res = await fetch(pageUrl);
    const data = (await res.json()) as {
      results: PlacesResult[];
      next_page_token?: string;
      status: string;
    };

    if (!['OK', 'ZERO_RESULTS'].includes(data.status)) break;
    results.push(...(data.results ?? []));
    nextPageToken = data.next_page_token;
    if (!nextPageToken) break;

    await new Promise(r => setTimeout(r, 2000));
  }

  return results;
}

// Run all configured keywords PLUS a type=locksmith search.
// Merge by place_id — each place appears exactly once regardless of which search found it.
// Returns:
//   - deduped results array
//   - typeMatchPlaceIds: Set of place_ids found by type=locksmith (for gbp_type_mismatch)
//   - autoKeywordPlaceIds: Set of place_ids surfaced by an auto-focused keyword
//     (drives the auto-focus classification downstream).
async function searchAll(
  lat: number,
  lng: number,
  keywords: string[],
  apiKey: string
): Promise<{
  results: PlacesResult[];
  typeMatchPlaceIds: Set<string>;
  autoKeywordPlaceIds: Set<string>;
}> {
  const seen = new Map<string, PlacesResult>(); // place_id → result
  const autoKeywordPlaceIds = new Set<string>();

  // 1. Keyword searches (one per keyword). Track auto-keyword surfacing.
  for (const keyword of keywords) {
    const batch = await nearbySearch(lat, lng, apiKey, { kind: 'keyword', keyword });
    const isAuto = isAutoKeyword(keyword);
    for (const r of batch) {
      if (!seen.has(r.place_id)) seen.set(r.place_id, r);
      if (isAuto) autoKeywordPlaceIds.add(r.place_id);
    }
  }

  // 2. type=locksmith search — always runs regardless of keywords
  const typeResults = await nearbySearch(lat, lng, apiKey, { kind: 'type', type: 'locksmith' });
  const typeMatchPlaceIds = new Set<string>();
  for (const r of typeResults) {
    typeMatchPlaceIds.add(r.place_id);
    if (!seen.has(r.place_id)) seen.set(r.place_id, r);
  }

  return { results: [...seen.values()], typeMatchPlaceIds, autoKeywordPlaceIds };
}

// Detect GBP type mismatch: true if the place's types[] doesn't include 'locksmith'.
// Indicates the business may be miscategorised on Google Maps.
function detectGbpTypeMismatch(types?: string[]): boolean {
  if (!types || types.length === 0) return false; // can't determine — don't flag
  return !types.includes('locksmith');
}

async function getPlaceDetails(placeId: string, apiKey: string): Promise<PlacesResult | null> {
  const fields = [
    'place_id', 'name', 'formatted_address', 'geometry',
    'rating', 'user_ratings_total', 'website',
    'formatted_phone_number', 'international_phone_number',
    'types', 'business_status', 'opening_hours', 'url',
  ].join(',');

  const url = `${PLACES_BASE}/details/json?place_id=${placeId}&fields=${fields}&key=${apiKey}`;
  const res = await fetch(url);
  const data = (await res.json()) as { result: PlacesResult; status: string };
  if (data.status !== 'OK') return null;
  return data.result;
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Auth check — Vercel cron sends Authorization header automatically when CRON_SECRET is set
  const authHeader = req.headers['authorization'];
  const secret = process.env.CRON_SECRET;
  if (secret && authHeader !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'GOOGLE_PLACES_API_KEY not set' });
  }

  const startMs = Date.now();
  const city = (req.query.city as string) || getTargetCity();
  const keywords = resolveKeywords(req);
  const query = `${keywords.join(', ')} in ${city}, UK`;

  console.log(`[scout] Starting run — city: ${city}, keywords: ${keywords.join(', ')}`);

  let prospectsFound = 0;
  let prospectsNew = 0;
  let prospectsSuppressed = 0;
  let tierACnt = 0;
  let tierBCnt = 0;
  let tierCCnt = 0;
  let runError: string | undefined;

  try {
    // 1. Geocode city
    const coords = await geocodeCity(city, apiKey);
    if (!coords) throw new Error(`Could not geocode: ${city}`);

    // 2. Search for prospects (keyword searches + type=locksmith, deduped by place_id)
    const { results: placeResults, typeMatchPlaceIds, autoKeywordPlaceIds } =
      await searchAll(coords.lat, coords.lng, keywords, apiKey);
    console.log(
      `[scout] Found ${placeResults.length} raw places ` +
      `(type matches: ${typeMatchPlaceIds.size}, auto-kw matches: ${autoKeywordPlaceIds.size})`
    );
    prospectsFound = placeResults.length;

    // 3. Fetch details + dedup + filter + score + save each
    const ghl = createGhlClient();
    const chApiKey = process.env.COMPANIES_HOUSE_API_KEY;

    for (const place of placeResults) {
      try {
        // Get full place details — details has more reliable business_status + types
        const details = await getPlaceDetails(place.place_id, apiKey);
        if (!details) continue;

        // ── Lifecycle gate ────────────────────────────────────────────────────
        // Places API status values: OPERATIONAL | CLOSED_TEMPORARILY | CLOSED_PERMANENTLY.
        // (Previous code used 'PERMANENTLY_CLOSED' — wrong constant, never fired.)
        // Temporarily closed often means out-of-business or in transition; not worth
        // outreach. Hard-skip both non-operational states, log + count as suppressed.
        const businessStatus = details.business_status ?? 'OPERATIONAL';
        if (businessStatus === 'CLOSED_PERMANENTLY' || businessStatus === 'CLOSED_TEMPORARILY') {
          console.log(`[scout] Skip (${businessStatus}): ${details.name}`);
          prospectsSuppressed++;
          continue;
        }

        // ── Category gate ─────────────────────────────────────────────────────
        // 'locksmith' must be IN types[] at ANY position (multi-category GBPs are
        // common — locksmiths often co-categorize as 'car_repair', 'hardware_store',
        // etc.). Lock N Leave (storage facility, no 'locksmith' in types) gets
        // cleanly filtered. Auto-locksmith focus is graded *separately* below.
        const categories = details.types ?? [];
        if (!categories.includes('locksmith')) {
          console.log(`[scout] Skip (wrong_category: [${categories.join(',')}]): ${details.name}`);
          prospectsSuppressed++;
          continue;
        }

        // ── Auto-focus classification ─────────────────────────────────────────
        // Strath targets AUTO locksmiths specifically. We combine two signals:
        //   1. business name regex (auto/automotive/car key/transponder/...)
        //   2. discovered via an auto-focused keyword search
        // confirmed (both) and likely (one) flow as 'discovered'.
        // unknown (neither) flows as 'flagged' for manual review.
        const discoveredViaAutoKeyword = autoKeywordPlaceIds.has(details.place_id);
        const autoFocus = classifyAutoFocus(details.name, discoveredViaAutoKeyword);
        const isAutoFocused = autoFocus !== 'unknown';

        const rawPhone = details.formatted_phone_number ?? details.international_phone_number;
        const websiteUrl = details.website;

        // ── Dedup: place_id ──────────────────────────────────────────────────
        const existingByPlace = await findProspectByPlaceId(details.place_id);
        if (existingByPlace) {
          console.log(`[scout] Skip (place_id dup): ${details.name}`);
          continue;
        }

        // ── Dedup: normalized phone ──────────────────────────────────────────
        if (rawPhone) {
          const existingByPhone = await findProspectByPhone(rawPhone);
          if (existingByPhone) {
            console.log(`[scout] Skip (phone dup): ${details.name}`);
            continue;
          }
        }

        // ── Dedup: root domain ───────────────────────────────────────────────
        if (websiteUrl) {
          const domain = extractRootDomain(websiteUrl);
          if (domain) {
            const existingByDomain = await findProspectByDomain(domain);
            if (existingByDomain) {
              console.log(`[scout] Skip (domain dup): ${details.name} — domain ${domain} matches existing`);
              // Insert as suppressed duplicate so it is traceable
              await insertProspect({
                businessName: details.name,
                city,
                entityType: 'Unknown',
                googlePlaceId: details.place_id,
                websiteUrl,
                phone: rawPhone,
                fullAddress: details.formatted_address,
                icpTier: 'ungraded',
                status: 'do_not_contact',
                source: 'google_places',
                duplicateOfPlaceId: existingByDomain.googlePlaceId,
              });
              prospectsSuppressed++;
              continue;
            }
          }
        }

        // ── Prospect filter check ─────────────────────────────────────────────
        // NOTE: Franchise / aggregator suppression now handled via prospect_filters
        // table (ignore_name_contains rows). See migration_002 for seed data.
        const filterResult = await checkProspectFilters({
          businessName: details.name,
          googlePlaceId: details.place_id,
          websiteUrl,
        });

        if (filterResult.suppressed) {
          console.log(`[scout] Suppressed by filter (${filterResult.matchedRule}): ${details.name}`);
          prospectsSuppressed++;
          continue;
        }

        // ── Scoring ───────────────────────────────────────────────────────────
        const gbpStatus = classifyGbpStatus(details);
        const websiteStatus = classifyWebsiteStatus(websiteUrl);
        const isUrban = isUrbanCity(city);

        // Companies House lookup (non-blocking — defaults to Unknown on failure)
        const entityResolution = await resolveEntity(
          details.name,
          undefined,
          city,
          chApiKey
        ).catch(() => ({ entityType: 'Unknown' as const, confidence: 'not_found' as const }));

        // ICP raw score — tier is NOT assigned here, audit cron does that
        const { score, breakdown } = scoreProspect({
          gbpReviewCount: details.user_ratings_total,
          websiteStatus,
          gbpStatus,
          entityType: entityResolution.entityType,
          isUrban,
          franchiseFlag: false,
          hasPhone: !!rawPhone,
        });

        // Raw score counters (for run log — using same thresholds as before for tracking)
        if (score >= 70)       tierACnt++;
        else if (score >= 40)  tierBCnt++;
        else                   tierCCnt++;

        // ── GBP type mismatch detection ───────────────────────────────────────
        // True if the place was NOT found by type=locksmith search (possible miscategorisation)
        const gbpTypeMismatch =
          !typeMatchPlaceIds.has(details.place_id) &&
          detectGbpTypeMismatch(details.types);

        // ── Build prospect ────────────────────────────────────────────────────
        const prospect: Prospect = {
          businessName: details.name,
          city,
          fullAddress: details.formatted_address,
          latitude: details.geometry?.location.lat,
          longitude: details.geometry?.location.lng,
          phone: rawPhone,
          websiteUrl,
          googlePlaceId: details.place_id,
          gbpName: details.name,
          gbpRating: details.rating,
          gbpReviewCount: details.user_ratings_total,
          gbpStatus,
          gbpUrl: details.url,
          gbpTypeMismatch,
          gbpCategories: categories,
          businessStatus,
          autoFocus,
          entityType: entityResolution.entityType,
          companiesHouseNumber: entityResolution.companiesHouseNumber,
          companiesHouseName: entityResolution.companiesHouseName,
          websiteStatus,
          franchiseFlag: false,
          rawScore: score,
          // icpScore intentionally NOT set here — audit cron sets it after full analysis
          icpTier: 'ungraded',
          scoreBreakdown: breakdown,
          // Status priority: filter-flagged > non-auto > discovered.
          // 'unknown' auto-focus gets flagged so Tyler can review without losing
          // a possible auto-capable general locksmith.
          status: filterResult.flagged ? 'flagged'
                : !isAutoFocused        ? 'flagged'
                                        : 'discovered',
          source: 'google_places',
        };

        // ── Save to Neon ──────────────────────────────────────────────────────
        const prospectId = await insertProspect(prospect);
        prospectsNew++;

        console.log(
          `[scout] Saved ${details.name} — raw_score: ${score}` +
          (filterResult.flagged ? ' [FLAGGED]' : '')
        );

        // ── Push to GHL if above threshold ────────────────────────────────────
        // Flagged prospects (filter-flagged OR auto-focus=unknown) stay out of GHL
        // until reviewed. Opportunity is NOT created here — audit cron does that
        // after tier confirmation.
        if (score >= GHL_PUSH_RAW_SCORE_THRESHOLD && prospect.status === 'discovered') {
          try {
            const customFields = buildScoutCustomFields({
              rawScore: score,
              icpTier: 'Pending Audit',   // shown in GHL until audit confirms real tier
              websiteStatus,
              gbpStatus,
              gbpRating: details.rating,
              gbpReviewCount: details.user_ratings_total,
              gbpUrl: details.url,
              entityType: entityResolution.entityType,
              companiesHouseNumber: entityResolution.companiesHouseNumber,
              city,
              outreachStage: 'Not Contacted',
              businessName: details.name,
              websiteUrl: websiteUrl,
            });

            const ghlContactId = await ghl.upsertContact({
              name: details.name,
              phone: rawPhone ? normalizePhone(rawPhone) : undefined,
              website: websiteUrl,
              city,
              tags: [GHL.TAGS.coldOutreach],  // tier tag applied by audit cron
              customFields,
            });

            // Store contact ID only — no opportunity ID yet
            await updateProspectGhlIds(prospectId, ghlContactId, undefined);

            console.log(`[scout] Pushed to GHL: ${details.name} → contact ${ghlContactId} (no opportunity yet)`);
          } catch (ghlErr) {
            console.error(`[scout] GHL push failed for ${details.name}:`, ghlErr);
            // Non-fatal — prospect is in Neon, GHL sync can be retried
          }
        }

        // Small delay to stay within Google Places rate limits
        await new Promise(r => setTimeout(r, 300));

      } catch (placeErr) {
        console.error(`[scout] Error processing place ${place.place_id}:`, placeErr);
        // Continue with next place
      }
    }

  } catch (err) {
    runError = String(err);
    console.error('[scout] Run error:', err);
  } finally {
    // Always log the run
    await logScoutRun({
      city,
      query,
      searchKeyword: keywords.join(','),
      prospectsFound,
      prospectsNew,
      prospectsSuppressed,
      tierACCount: tierACnt,
      tierBCount: tierBCnt,
      tierCCount: tierCCnt,
      error: runError,
      durationMs: Date.now() - startMs,
    }).catch(console.error);
  }

  return res.status(200).json({
    city,
    keywords,
    prospectsFound,
    prospectsNew,
    prospectsSuppressed,
    rawScoreAbove70: tierACnt,
    rawScoreAbove40: tierBCnt,
    rawScoreBelow40: tierCCnt,
    durationMs: Date.now() - startMs,
    error: runError ?? null,
  });
}
