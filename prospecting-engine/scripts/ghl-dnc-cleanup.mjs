// Strath Agency — GHL DNC cleanup
// For every Neon record with status='do_not_contact' AND ghl_contact_id IS NOT NULL:
//   - add 'do-not-contact' tag in GHL
//   - set Outreach Stage custom field to 'Do Not Contact'
//   - set DNC Reason custom field to the Neon do_not_contact_reason value
//
// Live writes to GHL Strath Ops. Idempotent.

import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.NEON_DATABASE_URL);

const PIT = process.env.GHL_STRATH_OPS_PIT;
const LOCATION_ID = process.env.GHL_STRATH_OPS_LOCATION_ID || 'Wh5GIK1F7zKLfCiM55zh';
// `||` not `??` — `.env.local` may have GHL_BASE_URL set to empty string.
const BASE = process.env.GHL_BASE_URL || 'https://services.leadconnectorhq.com';

const FIELD_IDS = {
  outreachStage:      '73BozTdNQufntQ3mKc3K',
  doNotContactReason: 'ni2IQLKx5FVE9GV51KaI',
};

async function ghlRequest(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Authorization': `Bearer ${PIT}`,
      'Content-Type': 'application/json',
      'Version': '2021-07-28',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`GHL ${method} ${path} → ${res.status}: ${text}`);
  }
  return res.json();
}

async function main() {
  if (!PIT) throw new Error('GHL_STRATH_OPS_PIT not set');

  const targets = await sql`
    SELECT id, business_name, do_not_contact_reason, ghl_contact_id
    FROM prospects
    WHERE status = 'do_not_contact' AND ghl_contact_id IS NOT NULL
    ORDER BY business_name
  `;
  console.log(`Cleaning up ${targets.length} GHL contact(s).\n`);

  const results = [];
  for (const t of targets) {
    const reason = t.do_not_contact_reason ?? 'cleanup_unspecified';
    try {
      // 1. Add tag
      await ghlRequest('POST', `/contacts/${t.ghl_contact_id}/tags`, { tags: ['do-not-contact'] });

      // 2. Set Outreach Stage = 'Do Not Contact' + reason via custom fields
      await ghlRequest('PUT', `/contacts/${t.ghl_contact_id}`, {
        customFields: [
          { id: FIELD_IDS.outreachStage,      field_value: 'Do Not Contact' },
          { id: FIELD_IDS.doNotContactReason, field_value: reason },
        ],
      });

      results.push({ ok: true, name: t.business_name, ghl: t.ghl_contact_id, reason });
      console.log(`  ✓ ${t.business_name} (${t.ghl_contact_id})  reason=${reason}`);
    } catch (e) {
      results.push({ ok: false, name: t.business_name, ghl: t.ghl_contact_id, error: String(e).slice(0, 200) });
      console.error(`  ✗ ${t.business_name} (${t.ghl_contact_id}) — ${String(e).slice(0, 200)}`);
    }
    // Polite delay
    await new Promise(r => setTimeout(r, 250));
  }

  console.log(`\nsummary: succeeded=${results.filter(r => r.ok).length} failed=${results.filter(r => !r.ok).length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
