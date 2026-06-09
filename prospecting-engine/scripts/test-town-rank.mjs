#!/usr/bin/env node
// Strath Agency — Town-Rank local test (frugal, single prospect)
//
// Validates the two halves of lib/town-rank.ts against a real prospect:
//   1. extractServedTowns — fetches the prospect's homepage and parses the nav for
//      served towns (no API key, no cost).
//   2. scanTownRanks — ONLY runs if SERPER_API_KEY is set. One Serper call per town
//      (≤ MAX_TOWNS). Optionally persists to Neon with PERSIST=1.
//
// Run with Node's type stripping so it can import the .ts lib directly:
//   node --experimental-strip-types scripts/test-town-rank.mjs --id <uuid>
//
// Env:
//   NEON_DATABASE_URL  — to load the prospect (and to PERSIST=1)
//   SERPER_API_KEY     — optional; enables the live rank scan
//   KEYWORD            — search phrase (default "auto locksmith")
//   PERSIST=1          — write the scan back to prospects.town_ranks

import { neon } from '@neondatabase/serverless';
import { extractServedTowns, scanTownRanks } from '../lib/town-rank.ts';

const args = process.argv.slice(2);
const idArg = args.includes('--id') ? args[args.indexOf('--id') + 1] : process.env.PROSPECT_ID;
const KEYWORD = process.env.KEYWORD ?? 'auto locksmith';
const DB = process.env.NEON_DATABASE_URL;
const SERPER = process.env.SERPER_API_KEY;

if (!DB) { console.error('NEON_DATABASE_URL required'); process.exit(1); }
if (!idArg) { console.error('Pass --id <uuid> (or PROSPECT_ID env)'); process.exit(1); }

const sql = neon(DB);
const rows = await sql`SELECT id, business_name, city, website_url, google_place_id FROM prospects WHERE id = ${idArg} LIMIT 1`;
if (!rows[0]) { console.error('Prospect not found'); process.exit(1); }
const p = rows[0];

console.log(`\n▸ Prospect: ${p.business_name} (${p.city})`);
console.log(`  Website:  ${p.website_url ?? '—'}`);
console.log(`  place_id: ${p.google_place_id ?? '—'}\n`);

// 1) Town extraction (free)
let html = '';
if (p.website_url) {
  try {
    const url = p.website_url.startsWith('http') ? p.website_url : `https://${p.website_url}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StrathAuditBot/1.0)', Accept: 'text/html' },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) html = await res.text();
    console.log(`  Homepage fetch: ${res.status} (${html.length} bytes)`);
  } catch (e) {
    console.log(`  Homepage fetch failed: ${e}`);
  }
}

const { towns, source } = extractServedTowns(html, p.city);
console.log(`\n  Town source: ${source}`);
console.log(`  Towns (${towns.length}): ${towns.join(', ')}\n`);

// 2) Live rank scan (only if Serper key present)
if (!SERPER) {
  console.log('  SERPER_API_KEY not set — skipping live rank scan (extraction validated above).');
  process.exit(0);
}

console.log(`  Running Serper scan ("${KEYWORD} <town>") — ${towns.length} calls...\n`);
const scan = await scanTownRanks({
  towns,
  townSource: source,
  keyword: KEYWORD,
  businessName: p.business_name,
  placeId: p.google_place_id ?? undefined,
  serperKey: SERPER,
});

for (const t of scan.towns) {
  const rank = t.rank === null ? 'not found' : `#${t.rank} (${t.matchedBy})`;
  console.log(`    ${t.town.padEnd(20)} ${String(rank).padEnd(16)} top: ${t.topResult ?? '—'}`);
}
console.log(`\n  Summary: top-3 in ${scan.topThreeCount}/${scan.totalTowns}, found in ${scan.foundCount}/${scan.totalTowns}`);

if (process.env.PERSIST === '1') {
  await sql`UPDATE prospects SET town_ranks = ${JSON.stringify(scan)}::jsonb, town_ranks_scanned_at = now(), updated_at = now() WHERE id = ${idArg}`;
  console.log('  Persisted to prospects.town_ranks ✓');
}
