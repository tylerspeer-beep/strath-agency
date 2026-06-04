// Strath Agency — One-off Neon cleanup
// Applies migrations 005 + 006 (inline DDL, not file read — neon http client
// only supports tagged templates), then marks bad records as do_not_contact
// with a reason string. Reports counts by reason before/after.
// Read+writes Neon directly. Does NOT touch GHL.
//
// Usage: node scripts/cleanup-neon.mjs

import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.NEON_DATABASE_URL);

async function safe(label, fn) {
  try { await fn(); }
  catch (e) { console.error(`[${label}] FAILED:`, e.message); throw e; }
}

async function main() {
  // ── 1. Migration 005 — business_status, gbp_categories, storage filters ────
  await safe('mig005:business_status', () =>
    sql`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS business_status TEXT`);
  await safe('mig005:gbp_categories', () =>
    sql`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS gbp_categories TEXT[]`);

  const storageFilterRows = [
    ['Lock N Leave',  'Self-storage chain — not a locksmith'],
    ["Lok'nStore",    'Self-storage chain'],
    ['Big Yellow',    'Self-storage chain'],
    ['Safestore',     'Self-storage chain'],
    ['Self Storage',  'Self-storage category name'],
    ['Storage King',  'Self-storage chain'],
    ['Access Self',   'Self-storage chain'],
  ];
  for (const [value, reason] of storageFilterRows) {
    await sql`
      INSERT INTO prospect_filters (filter_type, value, reason, added_by)
      VALUES ('ignore_name_contains', ${value}, ${reason}, 'system')
      ON CONFLICT (filter_type, value) DO NOTHING
    `;
  }
  console.log('[migration_005] applied');

  // ── 2. Migration 006 — auto_focus + franchise tracking ─────────────────────
  await safe('mig006:auto_focus', () =>
    sql`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS auto_focus TEXT`);
  await safe('mig006:franchise_detected_by', () =>
    sql`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS franchise_detected_by TEXT`);
  await safe('mig006:do_not_contact_reason', () =>
    sql`ALTER TABLE prospects ADD COLUMN IF NOT EXISTS do_not_contact_reason TEXT`);

  for (const value of ['franchise', 'franchisee']) {
    await sql`
      INSERT INTO prospect_filters (filter_type, value, reason, added_by)
      VALUES ('ignore_keyword', ${value}, 'Generic franchise marker', 'system')
      ON CONFLICT (filter_type, value) DO NOTHING
    `;
  }
  await safe('mig006:idx_auto', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_prospects_auto_focus ON prospects(auto_focus)`);
  await safe('mig006:idx_franchise', () =>
    sql`CREATE INDEX IF NOT EXISTS idx_prospects_franchise_flag ON prospects(franchise_flag)`);
  console.log('[migration_006] applied');

  // ── 3. Pre-cleanup state ───────────────────────────────────────────────────
  console.log('\n── pre-cleanup status mix ──');
  const preStatus = await sql`SELECT status, COUNT(*)::int AS n FROM prospects GROUP BY status ORDER BY n DESC`;
  preStatus.forEach(r => console.log(`  ${r.status.padEnd(20)} ${r.n}`));

  const phantom = await sql`
    SELECT COUNT(*)::int AS n FROM prospects
    WHERE status NOT IN ('do_not_contact')
      AND phone IS NULL AND email IS NULL AND website_url IS NULL
  `;
  console.log(`\n[scoping] phantom_no_contact candidates: ${phantom[0].n}`);

  // Compute storage-chain candidates by reading storage names + LIKE in JS
  const storageNames = storageFilterRows.map(([v]) => v.toLowerCase());
  const allActive = await sql`
    SELECT id, business_name FROM prospects
    WHERE status NOT IN ('do_not_contact')
  `;
  const storageHits = allActive.filter(r => {
    const lower = r.business_name.toLowerCase();
    return storageNames.some(n => lower.includes(n));
  });
  console.log(`[scoping] storage_chain candidates:      ${storageHits.length}`);

  // Franchise retroactive: any active record matching ANY ignore_name_contains
  // or ignore_keyword filter token.
  const filterRows = await sql`
    SELECT value FROM prospect_filters
    WHERE filter_type IN ('ignore_name_contains', 'ignore_keyword')
  `;
  const filterTokens = filterRows.map(r => r.value.toLowerCase());
  // Don't double-count storage records — those are already counted above.
  const storageSet = new Set(storageHits.map(h => h.id));
  const franchiseHits = [];
  for (const r of allActive) {
    if (storageSet.has(r.id)) continue;
    const lower = r.business_name.toLowerCase();
    const token = filterTokens.find(t => lower.includes(t));
    // Skip storage tokens too (they overlap with our storage list)
    if (token && !storageNames.includes(token)) {
      franchiseHits.push({ id: r.id, name: r.business_name, token });
    }
  }
  console.log(`[scoping] franchise_retroactive candidates: ${franchiseHits.length}`);

  // ── 4. Apply UPDATEs ───────────────────────────────────────────────────────
  console.log('\n── applying cleanup ──');

  const r1 = await sql`
    UPDATE prospects
    SET status = 'do_not_contact',
        do_not_contact_reason = 'phantom_no_contact',
        updated_at = now()
    WHERE status NOT IN ('do_not_contact')
      AND phone IS NULL AND email IS NULL AND website_url IS NULL
    RETURNING id
  `;
  console.log(`  phantom_no_contact     marked: ${r1.length}`);

  let storageMarked = 0;
  for (const hit of storageHits) {
    const r = await sql`
      UPDATE prospects
      SET status = 'do_not_contact',
          do_not_contact_reason = 'storage_chain',
          updated_at = now()
      WHERE id = ${hit.id} AND status NOT IN ('do_not_contact')
      RETURNING id
    `;
    storageMarked += r.length;
  }
  console.log(`  storage_chain          marked: ${storageMarked}`);

  let franchiseMarked = 0;
  for (const hit of franchiseHits) {
    const r = await sql`
      UPDATE prospects
      SET status = 'do_not_contact',
          do_not_contact_reason = ${'franchise_retroactive:' + hit.token},
          franchise_flag = TRUE,
          franchise_detected_by = 'filter_match',
          updated_at = now()
      WHERE id = ${hit.id} AND status NOT IN ('do_not_contact')
      RETURNING id
    `;
    franchiseMarked += r.length;
  }
  console.log(`  franchise_retroactive  marked: ${franchiseMarked}`);

  // ── 5. Post-cleanup ────────────────────────────────────────────────────────
  console.log('\n── post-cleanup status mix ──');
  const postStatus = await sql`SELECT status, COUNT(*)::int AS n FROM prospects GROUP BY status ORDER BY n DESC`;
  postStatus.forEach(r => console.log(`  ${r.status.padEnd(20)} ${r.n}`));

  console.log('\n── do_not_contact_reason breakdown (all DNC records) ──');
  const reasons = await sql`
    SELECT COALESCE(do_not_contact_reason, '(no reason set — pre-cleanup record)') AS reason,
           COUNT(*)::int AS n
    FROM prospects
    WHERE status = 'do_not_contact'
    GROUP BY do_not_contact_reason
    ORDER BY n DESC
  `;
  reasons.forEach(r => console.log(`  ${r.reason.padEnd(50)} ${r.n}`));

  // ── 6. GHL overlap warning ─────────────────────────────────────────────────
  const ghlOverlap = await sql`
    SELECT business_name, do_not_contact_reason, ghl_contact_id
    FROM prospects
    WHERE status = 'do_not_contact' AND ghl_contact_id IS NOT NULL
    ORDER BY do_not_contact_reason
  `;
  console.log(`\n── ${ghlOverlap.length} DNC records already exist in GHL (manual cleanup needed) ──`);
  ghlOverlap.forEach(r =>
    console.log(`  ${r.business_name.padEnd(40)} ${(r.do_not_contact_reason ?? '(none)').padEnd(30)} ghl=${r.ghl_contact_id}`)
  );

  // ── 7. Closed-business note ────────────────────────────────────────────────
  const noBizStatus = await sql`
    SELECT COUNT(*)::int AS n FROM prospects WHERE business_status IS NULL
  `;
  console.log(
    `\n── ${noBizStatus[0].n} records have NULL business_status (column added today). ` +
    `Cannot retroactively detect CLOSED_* without re-fetching Places. Future scout runs ` +
    `will populate this field. ──`
  );

  // ── 8. New backfill candidate count ────────────────────────────────────────
  const backfillNow = await sql`
    SELECT COUNT(*)::int AS n FROM prospects
    WHERE ghl_contact_id IS NULL
      AND COALESCE(raw_score, icp_score, 0) >= 40
      AND status NOT IN ('do_not_contact', 'flagged')
  `;
  console.log(`\n── Backfill candidates AFTER cleanup: ${backfillNow[0].n} (was 139 before) ──`);
}

main().catch(e => { console.error(e); process.exit(1); });
