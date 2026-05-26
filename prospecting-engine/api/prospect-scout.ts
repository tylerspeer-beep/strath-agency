// Strath Agency — Prospect Scout Cron
// Vercel cron function: runs on schedule (configured in vercel.json)
// Route: /api/prospect-scout
//
// What it does:
//   1. Picks the next city from SCOUT_TARGET_CITIES env var (round-robin)
//   2. Calls Google Places Nearby Search for "locksmith" in that city
//   3. Fetches full Place Details for each result (phone, website, etc.)
//   4. Runs Companies House entity lookup
//   5. Scores each prospect with ICP formula
//   6. Saves new prospects to Neon DB (skips duplicates by place_id or phone)
//   7. Pushes Tier A + B to GHL Strath Ops (contact + opportunity in "Identified" stage)
//   8. Logs the run to scout_runs table
//
// Trigger: Vercel cron (see vercel.json) OR manual POST with CRON_SECRET header
// Protected: Authorization: Bearer {CRON_SECRET}

import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  scoreProspect,
  classifyWebsiteStatus,
  classifyGbpStatus,
  isUrbanCity,
  detectFranchise,
} from '../lib/scoring.js';
import { resolveEntity } from '../lib/companies-house.js';
import {
  createGhlClient,
  GHL,
  buildProspectCustomFields,
} from '../lib/ghl-client.js';
import {
  findProspectByPlaceId,
  findProspectByPhone,
  insertProspect,
  updateProspectGhlIds,
  logScoutRun,
} from '../lib/db.js';
import type { Prospect, PlacesResult } from '../lib/types.js';

const PLACES_BASE = 'https://maps.googleapis.com/maps/api/place';

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

async function searchLocksmiths(
  lat: number,
  lng: number,
  apiKey: string
): Promise<PlacesResult[]> {
  // Nearby Search — 10km radius, type=locksmith
  const url =
    `${PLACES_BASE}/nearbysearch/json` +
    `?location=${lat},${lng}` +
    `&radius=10000` +
    `&type=locksmith` +
    `&key=${apiKey}`;

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

    // Places API requires a short pause before using next_page_token
    await new Promise(r => setTimeout(r, 2000));
  }

  return results;
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
  const query = `locksmith in ${city}, UK`;

  console.log(`[scout] Starting run — city: ${city}`);

  let prospectsFound = 0;
  let prospectsNew = 0;
  let tierACnt = 0;
  let tierBCnt = 0;
  let tierCCnt = 0;
  let runError: string | undefined;

  try {
    // 1. Geocode city
    const coords = await geocodeCity(city, apiKey);
    if (!coords) throw new Error(`Could not geocode: ${city}`);

    // 2. Search for locksmiths
    const placeResults = await searchLocksmiths(coords.lat, coords.lng, apiKey);
    console.log(`[scout] Found ${placeResults.length} raw places`);
    prospectsFound = placeResults.length;

    // 3. Fetch details + score + save each
    const ghl = createGhlClient();
    const chApiKey = process.env.COMPANIES_HOUSE_API_KEY;

    for (const place of placeResults) {
      // Skip permanently closed
      if (place.business_status === 'PERMANENTLY_CLOSED') continue;

      try {
        // Get full place details
        const details = await getPlaceDetails(place.place_id, apiKey);
        if (!details) continue;

        const phone = details.formatted_phone_number ?? details.international_phone_number;
        const websiteUrl = details.website;

        // Dedup check — skip if we already have this place or phone
        const existingByPlace = await findProspectByPlaceId(details.place_id);
        if (existingByPlace) continue;
        if (phone) {
          const existingByPhone = await findProspectByPhone(phone);
          if (existingByPhone) continue;
        }

        // Franchise / aggregator check — skip
        const isFranchise = detectFranchise(details.name, websiteUrl);
        if (isFranchise) {
          console.log(`[scout] Skip franchise: ${details.name}`);
          continue;
        }

        // Derive scoring inputs
        const gbpStatus = classifyGbpStatus(details);
        const websiteStatus = classifyWebsiteStatus(websiteUrl);
        const isUrban = isUrbanCity(city);

        // Companies House lookup (non-blocking — default Unknown on failure)
        const entityResolution = await resolveEntity(
          details.name,
          undefined,
          city,
          chApiKey
        ).catch(() => ({ entityType: 'Unknown' as const, confidence: 'not_found' as const }));

        // ICP score
        const { score, tier, breakdown } = scoreProspect({
          gbpReviewCount: details.user_ratings_total,
          websiteStatus,
          gbpStatus,
          entityType: entityResolution.entityType,
          isUrban,
          franchiseFlag: false, // already filtered above
        });

        // Tier counters
        if (tier === 'A - Hot (70+)') tierACnt++;
        else if (tier === 'B - Warm (40-69)') tierBCnt++;
        else tierCCnt++;

        // Build prospect object
        const prospect: Prospect = {
          businessName: details.name,
          city,
          fullAddress: details.formatted_address,
          latitude: details.geometry?.location.lat,
          longitude: details.geometry?.location.lng,
          phone,
          websiteUrl,
          googlePlaceId: details.place_id,
          gbpName: details.name,
          gbpRating: details.rating,
          gbpReviewCount: details.user_ratings_total,
          gbpStatus,
          gbpUrl: details.url,
          entityType: entityResolution.entityType,
          companiesHouseNumber: entityResolution.companiesHouseNumber,
          companiesHouseName: entityResolution.companiesHouseName,
          websiteStatus,
          franchiseFlag: false,
          icpScore: score,
          icpTier: tier,
          scoreBreakdown: breakdown,
          status: 'discovered',
          source: 'google_places',
        };

        // Save to Neon
        const prospectId = await insertProspect(prospect);
        prospectsNew++;

        console.log(`[scout] Saved ${details.name} — Tier ${tier.charAt(0)} (${score})`);

        // Push Tier A and B to GHL immediately
        if (tier === 'A - Hot (70+)' || tier === 'B - Warm (40-69)') {
          try {
            const tierTag = tier === 'A - Hot (70+)' ? GHL.TAGS.tierA : GHL.TAGS.tierB;

            const customFields = buildProspectCustomFields({
              icpScore: score,
              icpTier: tier,
              websiteStatus,
              gbpStatus,
              gbpRating: details.rating,
              gbpReviewCount: details.user_ratings_total,
              entityType: entityResolution.entityType,
              companiesHouseNumber: entityResolution.companiesHouseNumber,
              city,
              outreachStage: 'Not Contacted',
            });

            const ghlContactId = await ghl.upsertContact({
              name: details.name,
              phone,
              website: websiteUrl,
              city,
              tags: [tierTag, GHL.TAGS.coldOutreach],
              customFields,
            });

            const ghlOppId = await ghl.createOpportunity({
              title: `${details.name} — ${city}`,
              pipelineId: GHL.PIPELINE_ID,
              pipelineStageId: GHL.STAGES.identified,
              contactId: ghlContactId,
              status: 'open',
            });

            await updateProspectGhlIds(prospectId, ghlContactId, ghlOppId);

            console.log(`[scout] Pushed to GHL: ${details.name} → contact ${ghlContactId}`);
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
      prospectsFound,
      prospectsNew,
      tierACCount: tierACnt,
      tierBCount: tierBCnt,
      tierCCount: tierCCnt,
      error: runError,
      durationMs: Date.now() - startMs,
    }).catch(console.error);
  }

  return res.status(200).json({
    city,
    prospectsFound,
    prospectsNew,
    tierA: tierACnt,
    tierB: tierBCnt,
    tierC: tierCCnt,
    durationMs: Date.now() - startMs,
    error: runError ?? null,
  });
}
