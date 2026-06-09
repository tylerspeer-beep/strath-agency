// Strath Agency — Town Map-Rank Scan
// Vercel function: POST /api/town-rank-scan?id={prospectId}   (single)
//                  POST /api/town-rank-scan?batch={n}         (next n unscanned)
//
// What it does per prospect:
//   1. Fetches the homepage and parses the nav/menu for the towns they serve
//      (the "10 town links" pattern). Falls back to city + nearby towns.
//   2. For each town (capped at MAX_TOWNS), geocodes the town centre (free, OSM)
//      and runs ONE Serper Google-Maps query for "{keyword} {town}", recording the
//      prospect's local-pack rank by place_id (preferred) or business-name match.
//   3. Caches the full scan to Neon (prospects.town_ranks) so the report renders
//      from cache — Serper is hit once per scan, never per report view.
//
// Kept separate from the daily audit cron because the per-town geocode + Serper
// loop is slow (≈1.5s/town); folding it into the batch audit would blow the 60s
// function limit. Run it deliberately (single id for testing, small batch for fill-in).
//
// Env vars required:
//   NEON_DATABASE_URL  — DB reads/writes
//   SERPER_API_KEY     — Serper.dev Maps API (frugal: one call per town)
//   CRON_SECRET        — endpoint protection
//
// Query params:
//   id      — scan exactly this prospect (UUID)
//   batch   — scan the next N unscanned prospects (default 1, max 10)
//   keyword — search phrase (default "auto locksmith")
//
// Protected: Authorization: Bearer {CRON_SECRET}

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getProspectById, getProspectsNeedingTownRankScan, updateProspectTownRanks } from '../lib/db.js';
import { extractServedTowns, scanTownRanks } from '../lib/town-rank.js';
import type { Prospect } from '../lib/types.js';

const DEFAULT_KEYWORD = 'auto locksmith';

async function fetchHomepage(url: string): Promise<string | null> {
  try {
    const cleanUrl = url.startsWith('http') ? url : `https://${url}`;
    const res = await fetch(cleanUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StrathAuditBot/1.0)', 'Accept': 'text/html' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function scanOne(prospect: Prospect, keyword: string, serperKey: string) {
  // Town source: homepage nav if we can fetch + parse it, otherwise city + nearby.
  const html = prospect.websiteUrl ? await fetchHomepage(prospect.websiteUrl) : null;
  const { towns, source } = extractServedTowns(html ?? '', prospect.city);

  const scan = await scanTownRanks({
    towns,
    townSource: source,
    keyword,
    businessName: prospect.businessName,
    placeId: prospect.googlePlaceId,
    serperKey,
  });

  await updateProspectTownRanks(prospect.id!, scan);

  return {
    id: prospect.id,
    name: prospect.businessName,
    townSource: scan.townSource,
    totalTowns: scan.totalTowns,
    foundCount: scan.foundCount,
    topThreeCount: scan.topThreeCount,
  };
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const authHeader = req.headers['authorization'];
  const secret = process.env.CRON_SECRET;
  if (secret && authHeader !== `Bearer ${secret}`) {
    return res.status(401).json({ error: 'Unauthorised' });
  }

  const serperKey = process.env.SERPER_API_KEY;
  if (!serperKey) {
    return res.status(500).json({ error: 'SERPER_API_KEY not set' });
  }

  const keyword = (req.query.keyword as string) || DEFAULT_KEYWORD;
  const id = req.query.id as string | undefined;

  // Resolve the prospect set: a single id, or the next N unscanned.
  let prospects: Prospect[];
  if (id) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
      return res.status(400).json({ error: 'Invalid prospect id' });
    }
    const p = await getProspectById(id);
    if (!p) return res.status(404).json({ error: 'Prospect not found' });
    prospects = [p];
  } else {
    const batch = Math.min(10, Math.max(1, parseInt(String(req.query.batch ?? '1'), 10)));
    prospects = await getProspectsNeedingTownRankScan(batch);
  }

  const results: unknown[] = [];
  for (const prospect of prospects) {
    try {
      console.log(`[town-rank] Scanning: ${prospect.businessName} (${prospect.city})`);
      results.push(await scanOne(prospect, keyword, serperKey));
    } catch (err) {
      console.error(`[town-rank] Scan failed for ${prospect.businessName}:`, err);
      results.push({ id: prospect.id, name: prospect.businessName, error: String(err) });
    }
  }

  return res.status(200).json({ scanned: results.length, keyword, results });
}
