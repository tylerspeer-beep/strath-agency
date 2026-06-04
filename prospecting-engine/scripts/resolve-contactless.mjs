// Strath Agency — One-off resolver for contactless backfill candidates
// Scrapes homepage HTML for phone/email and either persists the recovered
// contact info to Neon, or marks the record do_not_contact (no_contact_method).
//
// Read+writes Neon only. Does NOT touch GHL.
//
// Note: extraction logic mirrors lib/contact-extraction.ts. Inlined here so this
// one-off can run via plain node without a TS build step.

import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.NEON_DATABASE_URL);

// ── Contact extraction (mirror of lib/contact-extraction.ts) ─────────────────

const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_REGEX = /(?:\+44\s?|\(?0)\s?\d{1,5}\)?[\s.-]?\d{2,4}[\s.-]?\d{2,4}[\s.-]?\d{0,4}/g;
const TEL_HREF_REGEX = /href=["']tel:([^"']+)["']/gi;
const MAILTO_HREF_REGEX = /href=["']mailto:([^"'?]+)/gi;

function normalisePhone(raw) {
  const digits = raw.replace(/[^\d+]/g, '');
  let canonical = digits.startsWith('+44') ? '0' + digits.slice(3)
                : digits.startsWith('44') && digits.length >= 12 ? '0' + digits.slice(2)
                : digits;
  if (!canonical.startsWith('0')) return null;
  if (canonical.length < 10 || canonical.length > 11) return null;
  return canonical;
}

function isPlausibleEmail(addr) {
  const lower = addr.toLowerCase();
  if (/\.(png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|eot|css|js)$/i.test(lower)) return false;
  if (/^(noreply|no-reply|donotreply|do-not-reply|abuse|postmaster|webmaster)@/i.test(lower)) return false;
  if (/@(example|test|localhost|sentry|wixpress|cloudflare|google-analytics)\./i.test(lower)) return false;
  return true;
}

function extractContact(html) {
  const out = { phone: null, email: null, source: {} };
  const tel = TEL_HREF_REGEX.exec(html); TEL_HREF_REGEX.lastIndex = 0;
  if (tel?.[1]) {
    const norm = normalisePhone(tel[1]);
    if (norm) { out.phone = norm; out.source.phone = 'tel_href'; }
  }
  const mail = MAILTO_HREF_REGEX.exec(html); MAILTO_HREF_REGEX.lastIndex = 0;
  if (mail?.[1] && isPlausibleEmail(mail[1])) {
    out.email = mail[1].toLowerCase(); out.source.email = 'mailto_href';
  }
  if (!out.phone) {
    PHONE_REGEX.lastIndex = 0;
    let m;
    while ((m = PHONE_REGEX.exec(html)) !== null) {
      const norm = normalisePhone(m[0]);
      if (norm) { out.phone = norm; out.source.phone = 'body_text'; break; }
    }
  }
  if (!out.email) {
    const matches = html.match(EMAIL_REGEX) ?? [];
    for (const e of matches) {
      if (isPlausibleEmail(e)) { out.email = e.toLowerCase(); out.source.email = 'body_text'; break; }
    }
  }
  return out;
}

// ── Resolver ─────────────────────────────────────────────────────────────────

async function fetchHomepage(url) {
  try {
    const clean = url.startsWith('http') ? url : `https://${url}`;
    const res = await fetch(clean, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; StrathAuditBot/1.0)', 'Accept': 'text/html' },
      signal: AbortSignal.timeout(10000),
      redirect: 'follow',
    });
    if (!res.ok) return null;
    return (await res.text()).slice(0, 12000);
  } catch {
    return null;
  }
}

async function main() {
  const targets = await sql`
    SELECT id, business_name, website_url, status, raw_score, icp_score
    FROM prospects
    WHERE phone IS NULL AND email IS NULL
      AND status NOT IN ('do_not_contact')
    ORDER BY COALESCE(raw_score, icp_score, 0) DESC
  `;
  console.log(`Found ${targets.length} contactless records to resolve.\n`);

  let recovered = 0;
  let markedDnc = 0;
  const results = [];

  for (const r of targets) {
    if (!r.website_url) {
      await sql`
        UPDATE prospects SET status='do_not_contact',
          do_not_contact_reason='no_contact_method', updated_at=now()
        WHERE id = ${r.id}
      `;
      markedDnc++;
      results.push({ name: r.business_name, outcome: 'no_website → DNC' });
      continue;
    }

    const html = await fetchHomepage(r.website_url);
    if (!html) {
      await sql`
        UPDATE prospects SET status='do_not_contact',
          do_not_contact_reason='no_contact_method', updated_at=now()
        WHERE id = ${r.id}
      `;
      markedDnc++;
      results.push({ name: r.business_name, url: r.website_url, outcome: 'fetch_failed → DNC' });
      continue;
    }

    const c = extractContact(html);
    if (c.phone || c.email) {
      await sql`
        UPDATE prospects SET phone=${c.phone}, email=${c.email}, updated_at=now()
        WHERE id = ${r.id}
      `;
      recovered++;
      results.push({
        name: r.business_name,
        url: r.website_url,
        outcome: `recovered phone=${c.phone ?? '-'} (${c.source.phone ?? '-'}) email=${c.email ?? '-'} (${c.source.email ?? '-'})`,
      });
    } else {
      await sql`
        UPDATE prospects SET status='do_not_contact',
          do_not_contact_reason='no_contact_method', updated_at=now()
        WHERE id = ${r.id}
      `;
      markedDnc++;
      results.push({ name: r.business_name, url: r.website_url, outcome: 'site_no_contact → DNC' });
    }
  }

  console.log('── outcomes ──');
  for (const r of results) {
    const url = r.url ? ` (${r.url})` : '';
    console.log(`  ${r.name}${url}\n    → ${r.outcome}`);
  }
  console.log(`\nsummary: recovered=${recovered}  marked_dnc=${markedDnc}  total=${targets.length}`);

  const post = await sql`
    SELECT COUNT(*)::int AS n FROM prospects
    WHERE ghl_contact_id IS NULL
      AND COALESCE(raw_score, icp_score, 0) >= 40
      AND status NOT IN ('do_not_contact', 'flagged')
      AND (phone IS NOT NULL OR email IS NOT NULL)
  `;
  console.log(`backfill candidates with phone/email after resolver: ${post[0].n}`);
}

main().catch(e => { console.error(e); process.exit(1); });
