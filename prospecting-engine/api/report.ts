// Strath Agency — Prospect Audit Report
// Vercel function: GET /api/report?id={prospectId}
//
// What it does:
//   1. Loads prospect + audit data from Neon by ID
//   2. Renders a branded HTML report showing website findings, GBP analysis,
//      AI visibility score, competitor gap, and quick wins
//   3. Tracks opens: first open, last open, open count → GHL contact fields
//   4. Open tracking pixel at /api/report?id={id}&px=1 (1x1 gif)
//
// Report URL format: https://{vercel-domain}/api/report?id={prospectId}
// This URL is stored in the GHL contact field contact.report_url at audit time.
//
// Env vars required:
//   NEON_DATABASE_URL        — DB reads
//   GHL_STRATH_OPS_PIT       — GHL field updates on open
//   GHL_STRATH_OPS_LOCATION_ID — GHL location
//   GHL_BASE_URL             — https://services.leadconnectorhq.com
//   REPORT_BASE_URL          — Public Vercel domain (e.g. https://strath-agency.vercel.app)
//
// Protected: no auth required (prospect-facing). ID is a UUID — not guessable.

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { neon } from '@neondatabase/serverless';
import { SCORE_WEIGHTS, PRESENCE_KEYS, PRESENCE_MAX } from '../lib/scoring.js';
import type { ScoreBreakdown } from '../lib/types.js';

// Prospect-facing labels for the presence categories (the only categories shown
// in the report — the internal ICP "fit" qualifiers are never surfaced).
const PRESENCE_LABELS: Record<string, string> = {
  reviews: 'Google Reviews',
  gbp: 'Google Business Profile',
  website: 'Website',
  phone: 'Phone & Contactability',
};

// ── Strath v2 brand — earthy data-tier colours (match the map pins) ───────────
// Single source for the green/amber/brick used by both the score bars (server)
// and the Leaflet pin colours (client JS, interpolated into the inline script).
const DATA_GREEN = '#2F7A56';
const DATA_AMBER = '#C19A52';
const DATA_BRICK = '#A4502E';

// ── 1x1 transparent GIF for open tracking pixel ──────────────────────────────
const TRACKING_PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

// ── GHL field updater ─────────────────────────────────────────────────────────
async function updateGhlReportFields(
  contactId: string,
  fields: { firstOpen?: string; lastOpen: string; openCount: number; sectionsViewed?: string }
) {
  const pit = process.env.GHL_STRATH_OPS_PIT;
  const baseUrl = process.env.GHL_BASE_URL ?? 'https://services.leadconnectorhq.com';
  if (!pit || !contactId) return;

  // GHL PUT /contacts requires field UUIDs (`id`), not key strings. Session 2 Bug #5.
  const customFields: Array<{ id: string; field_value: string | number }> = [
    { id: 'HBSvO8jZ1OIUEaCZRv99', field_value: fields.lastOpen },   // report_last_opened_at
    { id: '8jabUZ3jtnBSnPi8lA6W', field_value: fields.openCount },  // report_open_count
  ];

  if (fields.firstOpen) {
    customFields.push({ id: 'wtEdzyqquMh5nf1uUBI7', field_value: fields.firstOpen }); // report_first_opened_at
  }
  if (fields.sectionsViewed) {
    customFields.push({ id: 'Oft0VvnvXzHpjutMUqSi', field_value: fields.sectionsViewed }); // report_sections_viewed
  }

  try {
    await fetch(`${baseUrl}/contacts/${contactId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${pit}`,
        'Content-Type': 'application/json',
        'Version': '2021-07-28',
      },
      body: JSON.stringify({ customFields }),
    });
  } catch (err) {
    console.error('[report] GHL update failed:', err);
  }
}

// ── Score bar HTML helper ─────────────────────────────────────────────────────
function scoreBar(score: number, max: number, color: string): string {
  const pct = Math.round((score / max) * 100);
  return `<div class="score-bar-bg"><div class="score-bar-fill" style="width:${pct}%;background:${color}"></div></div>`;
}

// ── HTML escaping (anything that lands inside markup or an attribute) ──────────
function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Place photo proxy ─────────────────────────────────────────────────────────
// Resolves a prospect's GBP photo via Places Details → Place Photo, streaming the
// bytes so the API key stays server-side. Cached at the CDN (s-maxage) to bound
// the 2-call cost per photo. Returns 404 on any miss (image hides gracefully).
async function streamPlacePhoto(res: VercelResponse, placeId: string | null): Promise<void> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey || !placeId) {
    res.status(404).end();
    return;
  }
  try {
    const detailsUrl =
      `https://maps.googleapis.com/maps/api/place/details/json` +
      `?place_id=${encodeURIComponent(placeId)}&fields=photos&key=${apiKey}`;
    const dRes = await fetch(detailsUrl, { signal: AbortSignal.timeout(7000) });
    const dData = (await dRes.json()) as {
      result?: { photos?: { photo_reference: string }[] };
      status: string;
    };
    const ref = dData.result?.photos?.[0]?.photo_reference;
    if (!ref) {
      res.status(404).end();
      return;
    }
    const photoUrl =
      `https://maps.googleapis.com/maps/api/place/photo` +
      `?maxwidth=800&photo_reference=${encodeURIComponent(ref)}&key=${apiKey}`;
    const pRes = await fetch(photoUrl, { signal: AbortSignal.timeout(7000) }); // follows redirect to googleusercontent
    if (!pRes.ok || !pRes.body) {
      res.status(404).end();
      return;
    }
    res.setHeader('Content-Type', pRes.headers.get('content-type') ?? 'image/jpeg');
    // CDN-cache the resolved image for a week so repeat opens don't re-hit Google.
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800');
    const buf = Buffer.from(await pRes.arrayBuffer());
    res.status(200).end(buf);
  } catch (err) {
    console.error('[report] photo proxy failed:', err);
    res.status(404).end();
  }
}

// ── "Your Google listing" card (from Places data we already store) ─────────────
// Renders the branded listing card: name, rating, reviews, category, claimed badge
// and the GBP photo (via the same-origin proxy above). Shown whenever we have any
// GBP signal; independent of town-rank data.
function renderListingCard(p: Record<string, unknown>, photoUrl: string): string {
  const name        = String(p.business_name ?? 'Your Business');
  const rating      = p.gbp_rating != null ? Number(p.gbp_rating) : null;
  const reviews     = p.gbp_review_count != null ? Number(p.gbp_review_count) : null;
  const gbpStatus   = String(p.gbp_status ?? 'Unknown');
  const gbpUrl      = p.gbp_url ? String(p.gbp_url) : null;
  const cats        = Array.isArray(p.gbp_categories) ? (p.gbp_categories as string[]) : [];

  // Prettify the primary GBP category ('locksmith' → 'Locksmith'), default sensibly.
  const primaryCat = cats.find((c) => c && c !== 'point_of_interest' && c !== 'establishment');
  const category = primaryCat
    ? primaryCat.replace(/_/g, ' ').replace(/\b\w/g, (m) => m.toUpperCase())
    : 'Locksmith';

  const claimed = gbpStatus !== 'Unclaimed' && gbpStatus !== 'Unknown';
  const claimedBadge = claimed
    ? `<span class="gl-badge gl-badge-ok">✓ Claimed</span>`
    : `<span class="gl-badge gl-badge-warn">Unclaimed</span>`;

  const initial = esc(name.trim().charAt(0).toUpperCase() || 'B');

  // Star row (rounded to nearest half not needed — show numeric + filled stars).
  let stars = '';
  if (rating !== null) {
    const full = Math.round(rating);
    stars = '★★★★★'.slice(0, full) + '<span class="gl-star-empty">' + '★★★★★'.slice(full) + '</span>';
  }

  return `
  <div class="card gl-card">
    <div class="card-title">Your Google listing</div>
    <div class="gl-row">
      <div class="gl-photo">
        <div class="gl-photo-fallback">${initial}</div>
        <img src="${esc(photoUrl)}" alt="${esc(name)} on Google" loading="lazy"
             onload="this.style.opacity=1" onerror="this.remove()">
      </div>
      <div class="gl-body">
        <div class="gl-name">${esc(name)}</div>
        <div class="gl-cat">${esc(category)}</div>
        ${rating !== null ? `
        <div class="gl-rating">
          <span class="gl-stars">${stars}</span>
          <span class="gl-rating-num">${rating.toFixed(1)}</span>
          ${reviews !== null ? `<span class="gl-reviews">(${reviews} review${reviews === 1 ? '' : 's'})</span>` : ''}
        </div>` : (reviews !== null ? `<div class="gl-rating"><span class="gl-reviews">${reviews} review${reviews === 1 ? '' : 's'}</span></div>` : '')}
        <div class="gl-meta">${claimedBadge}${gbpUrl ? ` <a class="gl-link" href="${esc(gbpUrl)}" target="_blank" rel="noopener noreferrer">View on Google&nbsp;›</a>` : ''}</div>
      </div>
    </div>
    <p class="gl-note">This is how ${esc(name)} appears to customers searching on Google. It is the first thing most people see — and the asset that captures local jobs.</p>
  </div>`;
}

// ── "Where you rank on the map" section (Leaflet + OSM, from cached town_ranks) ─
// Pin per served town, coloured by local-pack rank (green top-3, amber 4–10, red
// not found). Framed neutrally against the prospect's OWN claimed towns. Returns
// { section, needsLeaflet } — the head include is added only when a map is shown.
interface TownRankRow {
  town: string; lat: number | null; lng: number | null;
  rank: number | null; found: boolean; topResult: string | null;
}
interface TownRankScanRow {
  towns?: TownRankRow[]; totalTowns?: number; foundCount?: number; topThreeCount?: number;
}

function renderRankMap(p: Record<string, unknown>): { section: string; needsLeaflet: boolean } {
  const tr = p.town_ranks as TownRankScanRow | null | undefined;
  const towns = Array.isArray(tr?.towns) ? tr!.towns! : [];
  if (!tr || towns.length === 0) {
    return { section: '', needsLeaflet: false };
  }

  const total = tr.totalTowns ?? towns.length;
  const topThree = tr.topThreeCount ?? towns.filter((t) => t.rank !== null && t.rank <= 3).length;
  const businessName = String(p.business_name ?? 'your business');

  // Only towns we could geocode get a pin; the rest still appear in the list below.
  const pinData = towns
    .filter((t) => typeof t.lat === 'number' && typeof t.lng === 'number')
    .map((t) => ({ town: t.town, lat: t.lat, lng: t.lng, rank: t.rank }));

  const rankColor = (rank: number | null) =>
    rank === null ? DATA_BRICK : rank <= 3 ? DATA_GREEN : rank <= 10 ? DATA_AMBER : DATA_BRICK;

  // Text list (accessible + a fallback when JS/coords are unavailable).
  const list = towns.map((t) => {
    const c = rankColor(t.rank);
    const label = t.rank === null ? 'Not in the top results' : `Ranks #${t.rank}`;
    return `
    <div class="rk-row">
      <span class="rk-dot" style="background:${c}"></span>
      <span class="rk-town">${esc(t.town)}</span>
      <span class="rk-rank" style="color:${c}">${esc(label)}</span>
    </div>`;
  }).join('');

  const headline = total > 0
    ? `Top 3 on Google Maps in <strong>${topThree} of ${total}</strong> ${total === 1 ? 'town' : 'towns'} you serve`
    : '';

  const section = `
  <div class="card">
    <div class="card-title">Where you rank on the map</div>
    <p style="font-size:13px;color:var(--muted);margin-bottom:16px">
      For each town ${esc(businessName)} serves, this is where the business currently
      sits in Google's Maps results for a typical "auto locksmith" search. Green is a
      top-3 spot (where most clicks go), amber is 4–10, brick means not showing in the
      top results yet.
    </p>
    ${headline ? `<div class="rk-headline">${headline}</div>` : ''}
    <div id="rankmap" class="rk-map"></div>
    <div class="rk-legend">
      <span><span class="rk-dot" style="background:${DATA_GREEN}"></span>Top 3</span>
      <span><span class="rk-dot" style="background:${DATA_AMBER}"></span>4–10</span>
      <span><span class="rk-dot" style="background:${DATA_BRICK}"></span>Not found</span>
    </div>
    <div class="rk-list">${list}</div>
  </div>
  <script>
    (function(){
      var towns = ${JSON.stringify(pinData)};
      if (!window.L || !towns.length) return;
      function color(r){ return r===null ? '${DATA_BRICK}' : r<=3 ? '${DATA_GREEN}' : r<=10 ? '${DATA_AMBER}' : '${DATA_BRICK}'; }
      function label(r){ return r===null ? '—' : '#'+r; }
      var map = L.map('rankmap', { scrollWheelZoom: false, attributionControl: true });
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 18,
        attribution: '&copy; OpenStreetMap contributors'
      }).addTo(map);
      var bounds = [];
      towns.forEach(function(t){
        var c = color(t.rank);
        var icon = L.divIcon({
          className: 'rk-pin',
          html: '<div class="rk-pin-inner" style="background:'+c+'">'+label(t.rank)+'</div>',
          iconSize: [34, 34], iconAnchor: [17, 17]
        });
        L.marker([t.lat, t.lng], { icon: icon })
          .addTo(map)
          .bindPopup('<strong>'+t.town+'</strong><br>'+(t.rank===null ? 'Not in the top results' : 'Ranks #'+t.rank));
        bounds.push([t.lat, t.lng]);
      });
      if (bounds.length === 1) { map.setView(bounds[0], 11); }
      else { map.fitBounds(bounds, { padding: [30, 30] }); }
    })();
  </script>`;

  return { section, needsLeaflet: true };
}

// ── Report HTML ───────────────────────────────────────────────────────────────
// Exported for render tests (api handler calls it directly below).
export function renderReport(p: Record<string, unknown>, trackingUrl: string, baseUrl: string): string {
  const businessName = String(p.business_name ?? 'Your Business');
  const city         = String(p.city ?? '');
  const websiteUrl   = p.website_url ? String(p.website_url) : null;
  const gbpRating    = p.gbp_rating ? Number(p.gbp_rating) : null;
  const gbpReviews   = p.gbp_review_count ? Number(p.gbp_review_count) : null;
  const gbpStatus    = String(p.gbp_status ?? 'Unknown');

  const obs1         = p.observation_1 ? String(p.observation_1) : null;
  const obs2         = p.observation_2 ? String(p.observation_2) : null;
  const competitor   = p.nearest_competitor ? String(p.nearest_competitor) : null;
  const entityType   = String(p.entity_type ?? 'Unknown');

  const hasSchema    = p.has_schema === true;
  const hasFaq       = p.has_faq === true;
  const mobileOk     = p.mobile_optimised === true;
  const hasTitleTag  = p.has_title_tag === true;
  const hasH1        = p.has_h1 === true;
  const websiteStatus = String(p.website_status ?? 'Unknown');
  const agencyMark   = p.agency_watermark ? String(p.agency_watermark) : null;

  // ── Online Presence Score (rendered from the STORED breakdown) ──────────────
  // The report does NOT compute its own rubric. It reads the stored score_breakdown
  // (written by scoreProspect, the single source of truth) and inverts each presence
  // category for display: strength = weight − opportunity-points. Higher = stronger.
  // PRESENCE_MAX and SCORE_WEIGHTS are imported from scoring.ts so weights live in
  // exactly one place. Falls back to null when no breakdown is stored (pre-rebuild
  // rows) — the per-signal findings cards below still render.
  let presenceBars: { label: string; strength: number; max: number }[] | null = null;
  let presenceScore: number | null = null;
  // Require the `phone` key: it only exists in breakdowns written by the rebuilt
  // GBP-first model, so this also screens out stale pre-rebuild rows (old weights).
  const rawBreakdown = p.score_breakdown as ScoreBreakdown | null | undefined;
  if (rawBreakdown && typeof rawBreakdown === 'object' && 'phone' in rawBreakdown) {
    presenceBars = PRESENCE_KEYS.map((k) => {
      const max = SCORE_WEIGHTS[k];
      const opportunity = Number((rawBreakdown as unknown as Record<string, number>)[k] ?? 0);
      const strength = Math.max(0, Math.min(max, max - opportunity));
      return { label: PRESENCE_LABELS[k] ?? k, strength, max };
    });
    const totalStrength = presenceBars.reduce((s, b) => s + b.strength, 0);
    presenceScore = Math.round((totalStrength / PRESENCE_MAX) * 100);
  }

  const websiteStatusColor = websiteStatus === 'Optimised' ? DATA_GREEN :
                             websiteStatus === 'Modern'    ? DATA_AMBER : DATA_BRICK;

  const gbpStatusColor = gbpStatus === 'Claimed - Optimised' ? DATA_GREEN :
                         gbpStatus === 'Claimed - Basic'     ? DATA_AMBER : DATA_BRICK;

  const quickWins: string[] = [];
  if (!hasSchema)   quickWins.push('Add LocalBusiness + LocksmithService schema markup');
  if (!hasFaq)      quickWins.push('Add an FAQ section (feeds ChatGPT + Google AI answers)');
  if (!mobileOk)    quickWins.push('Fix mobile viewport meta tag');
  if (!hasTitleTag) quickWins.push('Optimise page title to include location + service');
  if (!hasH1)       quickWins.push('Add a clear H1 headline to the homepage');
  if (agencyMark)   quickWins.push(`Remove ${agencyMark} watermark — it erodes trust`);
  if (gbpStatus === 'Unclaimed') quickWins.push('Claim and verify your Google Business Profile');
  if ((gbpReviews ?? 0) < 15)   quickWins.push('Launch a review request sequence (target: 40+ reviews)');

  const now = new Date().getFullYear();

  // Visual-proof sections (Places listing card + Leaflet/OSM rank map).
  const photoUrl = `${baseUrl}/api/report?id=${esc(p.id)}&photo=1`;
  const listingCard = renderListingCard(p, photoUrl);
  const { section: rankMapSection, needsLeaflet } = renderRankMap(p);
  const leafletHead = needsLeaflet ? `
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
        integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=" crossorigin="">
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"
          integrity="sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=" crossorigin=""></script>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Online Presence Report — ${businessName}</title>${leafletHead}
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
  <style>
    /* ── Strath v2 brand tokens ─────────────────────────────────────────────── */
    :root {
      --slate: #15181C;       /* base dark — hero + close */
      --graphite: #262B31;    /* dark surfaces */
      --stone: #ECEAE4;       /* warm body background */
      --paper: #F7F5F0;       /* card surface */
      --ink: #1B1E23;         /* primary text on light */
      --muted: #6B7177;       /* secondary grey (on light) */
      --muted-dk: #9AA0A6;    /* secondary grey (on dark) */
      --green: #1F4434;       /* British Racing Green — primary accent / CTA */
      --green-hover: #2E5C46;
      --honey: #C19A52;       /* sparing single highlight */
      --line: #E1DDD3;        /* hairline on light surfaces */
      /* earthy data tiers — match the map pins */
      --data-green: #2F7A56;
      --data-amber: #C19A52;
      --data-brick: #A4502E;
      --font-body: 'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      --font-mono: 'JetBrains Mono', ui-monospace, 'SFMono-Regular', Menlo, monospace;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--font-body);
      background: var(--stone);
      color: var(--ink);
      line-height: 1.6;
      -webkit-font-smoothing: antialiased;
      text-rendering: optimizeLegibility;
    }

    /* ── Header (dark hero) ── */
    .header {
      background: var(--slate);
      color: var(--paper);
      padding: 44px 24px 40px;
      text-align: center;
    }
    .header .crest { height: 64px; width: auto; display: block; margin: 0 auto 14px; }
    .header .wordmark {
      font-family: var(--font-body);
      font-weight: 800;
      font-size: 17px;
      letter-spacing: 0.34em;
      text-transform: uppercase;
      color: var(--stone);
      padding-left: 0.34em; /* optical centring for the tracking */
      margin-bottom: 22px;
    }
    .header .brand {
      font-family: var(--font-mono);
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 0.18em;
      text-transform: uppercase;
      color: var(--honey);
      margin-bottom: 12px;
    }
    .header h1 { font-size: clamp(24px, 5vw, 34px); font-weight: 700; letter-spacing: -0.01em; margin-bottom: 10px; }
    .header .subtitle { font-family: var(--font-mono); color: var(--muted-dk); font-size: 12.5px; letter-spacing: 0.02em; }

    .container { max-width: 720px; margin: 0 auto; padding: 28px 16px 56px; }
    .card {
      background: var(--paper);
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 28px;
      margin-bottom: 18px;
      box-shadow: 0 1px 2px rgba(21,24,28,0.04);
    }
    .card-title {
      font-family: var(--font-mono);
      font-size: 11px;
      font-weight: 500;
      text-transform: uppercase;
      letter-spacing: 0.14em;
      color: var(--muted);
      margin-bottom: 20px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--line);
    }
    .finding-row {
      display: flex;
      align-items: flex-start;
      gap: 14px;
      padding: 12px 0;
      border-bottom: 1px solid var(--line);
    }
    .finding-row:last-child { border-bottom: none; }
    .finding-icon {
      width: 24px;
      height: 24px;
      border-radius: 50%;
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      margin-top: 2px;
    }
    .icon-pass { background: rgba(47,122,86,0.14); color: var(--data-green); }
    .icon-fail { background: rgba(164,80,46,0.14); color: var(--data-brick); }
    .icon-warn { background: rgba(193,154,82,0.18); color: #8A6C2E; }
    .finding-text { flex: 1; }
    .finding-label { font-weight: 600; font-size: 14px; margin-bottom: 3px; color: var(--ink); }
    .finding-detail { font-size: 13px; color: var(--muted); }
    .status-badge {
      display: inline-block;
      font-family: var(--font-mono);
      padding: 3px 10px;
      border-radius: 6px;
      font-size: 11px;
      font-weight: 500;
      letter-spacing: 0.02em;
    }
    .badge-fail { background: rgba(164,80,46,0.14); color: var(--data-brick); }
    .badge-warn { background: rgba(193,154,82,0.18); color: #8A6C2E; }
    .badge-pass { background: rgba(47,122,86,0.14); color: var(--data-green); }
    .score-row {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 10px 0;
    }
    .score-label { font-size: 14px; width: 140px; flex-shrink: 0; color: var(--ink); }
    .score-bar-bg { flex: 1; background: var(--line); border-radius: 4px; height: 8px; overflow: hidden; }
    .score-bar-fill { height: 100%; border-radius: 4px; transition: width 0.6s ease; }
    .score-value { font-family: var(--font-mono); font-weight: 700; font-size: 13px; width: 40px; text-align: right; }
    .quick-win {
      display: flex;
      align-items: flex-start;
      gap: 12px;
      padding: 10px 0;
      border-bottom: 1px solid var(--line);
      font-size: 14px;
    }
    .quick-win:last-child { border-bottom: none; }
    .qw-num {
      width: 22px;
      height: 22px;
      background: var(--green);
      color: var(--paper);
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: var(--font-mono);
      font-size: 11px;
      font-weight: 700;
      flex-shrink: 0;
      margin-top: 1px;
    }
    .obs-box {
      background: var(--stone);
      border-left: 3px solid var(--line);
      padding: 14px 16px;
      border-radius: 0 8px 8px 0;
      margin-bottom: 12px;
      font-size: 14px;
      color: var(--ink);
    }
    .obs-box.critical { border-color: var(--data-brick); background: rgba(164,80,46,0.06); }
    .cta-section {
      background: var(--slate);
      color: var(--paper);
      border-radius: 14px;
      padding: 40px 28px;
      text-align: center;
      margin-top: 28px;
    }
    .cta-section h2 { font-size: 21px; font-weight: 700; letter-spacing: -0.01em; margin-bottom: 10px; }
    .cta-section p { color: var(--muted-dk); font-size: 14px; margin-bottom: 26px; }
    .cta-btn {
      display: inline-block;
      background: var(--green);
      color: var(--paper);
      padding: 14px 34px;
      border-radius: 9px;
      text-decoration: none;
      font-weight: 700;
      font-size: 15px;
      letter-spacing: 0.01em;
      transition: background 0.2s ease;
    }
    .cta-btn:hover { background: var(--green-hover); }
    .footer { text-align: center; color: var(--muted); font-size: 12px; margin-top: 28px; }
    .footer .footer-mono { font-family: var(--font-mono); letter-spacing: 0.02em; }

    /* ── Your Google listing card ── */
    .gl-row { display: flex; gap: 18px; align-items: stretch; }
    .gl-photo {
      position: relative; width: 120px; height: 120px; flex-shrink: 0;
      border-radius: 10px; overflow: hidden; background: var(--graphite);
    }
    .gl-photo-fallback {
      position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      font-family: var(--font-body);
      font-size: 44px; font-weight: 800; color: var(--muted-dk); background: var(--graphite);
    }
    .gl-photo img {
      position: relative; width: 100%; height: 100%; object-fit: cover;
      opacity: 0; transition: opacity 0.4s ease;
    }
    .gl-body { flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: center; }
    .gl-name { font-size: 18px; font-weight: 700; color: var(--ink); }
    .gl-cat { font-size: 13px; color: var(--muted); margin-bottom: 8px; }
    .gl-rating { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-bottom: 10px; }
    .gl-stars { color: var(--honey); font-size: 15px; letter-spacing: 1px; }
    .gl-star-empty { color: var(--line); }
    .gl-rating-num { font-family: var(--font-mono); font-weight: 700; color: var(--ink); font-size: 14px; }
    .gl-reviews { font-size: 13px; color: var(--muted); }
    .gl-meta { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
    .gl-badge { display: inline-block; font-family: var(--font-mono); padding: 3px 10px; border-radius: 6px; font-size: 11px; font-weight: 500; }
    .gl-badge-ok { background: rgba(47,122,86,0.14); color: var(--data-green); }
    .gl-badge-warn { background: rgba(164,80,46,0.14); color: var(--data-brick); }
    .gl-link { font-size: 13px; color: var(--green); text-decoration: none; font-weight: 600; }
    .gl-note { font-size: 13px; color: var(--muted); margin-top: 16px; padding-top: 14px; border-top: 1px solid var(--line); }

    /* ── Rank map ── */
    .rk-headline {
      font-size: 16px; color: var(--ink); background: var(--stone); border: 1px solid var(--line);
      border-radius: 8px; padding: 12px 16px; margin-bottom: 16px;
    }
    .rk-map { height: 320px; width: 100%; border-radius: 10px; overflow: hidden; z-index: 0; background: var(--line); }
    .rk-legend { display: flex; gap: 18px; font-family: var(--font-mono); font-size: 11px; color: var(--muted); margin: 12px 0 4px; }
    .rk-legend span { display: inline-flex; align-items: center; gap: 6px; }
    .rk-dot { width: 11px; height: 11px; border-radius: 50%; display: inline-block; flex-shrink: 0; }
    .rk-list { margin-top: 8px; }
    .rk-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid var(--line); font-size: 14px; }
    .rk-row:last-child { border-bottom: none; }
    .rk-town { flex: 1; color: var(--ink); }
    .rk-rank { font-family: var(--font-mono); font-weight: 700; font-size: 13px; }
    .rk-pin-inner {
      width: 30px; height: 30px; border-radius: 50%; color: white; font-family: var(--font-mono); font-weight: 700;
      font-size: 12px; display: flex; align-items: center; justify-content: center;
      border: 2px solid white; box-shadow: 0 1px 4px rgba(21,24,28,0.4);
    }

    @media (max-width: 480px) {
      .card { padding: 20px 16px; }
      .score-label { width: 110px; font-size: 13px; }
      .gl-row { flex-direction: column; }
      .gl-photo { width: 100%; height: 160px; }
    }
  </style>
</head>
<body>

<div class="header">
  <img class="crest" src="${esc(baseUrl)}/strath-crest.png" alt="Strath Agency crest" width="50" height="64">
  <div class="wordmark">Strath</div>
  <div class="brand">Prepared for</div>
  <h1>${businessName}</h1>
  <div class="subtitle">Online Presence Analysis · ${city}${city ? ' · ' : ''}${new Date().toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })}</div>
</div>

<div class="container">

  ${obs1 || obs2 ? `
  <div class="card">
    <div class="card-title">Key Findings</div>
    ${obs1 ? `<div class="obs-box critical"><strong>Finding 1:</strong> ${obs1.charAt(0).toUpperCase() + obs1.slice(1)}.</div>` : ''}
    ${obs2 ? `<div class="obs-box"><strong>Finding 2:</strong> ${obs2.charAt(0).toUpperCase() + obs2.slice(1)}.</div>` : ''}
  </div>` : ''}

  <!-- Your Google listing (Places data) -->
  ${listingCard}

  <!-- Where you rank on the map (cached Serper town ranks; hidden when none) -->
  ${rankMapSection}

  <!-- Website Analysis -->
  <div class="card">
    <div class="card-title">Website Analysis</div>

    <div class="finding-row">
      <div class="finding-icon ${websiteStatus === 'None' || websiteStatus === 'Basic/Old' ? 'icon-fail' : websiteStatus === 'Modern' ? 'icon-warn' : 'icon-pass'}">
        ${websiteStatus === 'None' || websiteStatus === 'Basic/Old' ? '✗' : websiteStatus === 'Modern' ? '~' : '✓'}
      </div>
      <div class="finding-text">
        <div class="finding-label">Website Quality</div>
        <div class="finding-detail">
          <span class="status-badge ${websiteStatus === 'Optimised' ? 'badge-pass' : websiteStatus === 'Modern' ? 'badge-warn' : 'badge-fail'}">${websiteStatus === 'None' ? 'No Website' : websiteStatus}</span>
          ${websiteUrl ? `<span style="margin-left:8px;font-size:12px;color:var(--muted)">${websiteUrl.replace(/^https?:\/\//, '')}</span>` : ''}
        </div>
      </div>
    </div>

    <div class="finding-row">
      <div class="finding-icon ${hasSchema ? 'icon-pass' : 'icon-fail'}">${hasSchema ? '✓' : '✗'}</div>
      <div class="finding-text">
        <div class="finding-label">Machine-readable business info <span style="color:var(--muted);font-weight:400">(schema markup)</span></div>
        <div class="finding-detail">${hasSchema ? 'Present — helps Google and AI tools read and cite this business.' : 'Missing — this is one of the structured-data signals AI search tools prefer when they cite local providers. Sites with it get cited more often.'}</div>
      </div>
    </div>

    <div class="finding-row">
      <div class="finding-icon ${hasFaq ? 'icon-pass' : 'icon-fail'}">${hasFaq ? '✓' : '✗'}</div>
      <div class="finding-text">
        <div class="finding-label">FAQ Section</div>
        <div class="finding-detail">${hasFaq ? 'Present — good for AI answer indexing.' : 'Missing — FAQ content is one of the formats AI tools draw on when answering local service questions.'}</div>
      </div>
    </div>

    <div class="finding-row">
      <div class="finding-icon ${mobileOk ? 'icon-pass' : 'icon-fail'}">${mobileOk ? '✓' : '✗'}</div>
      <div class="finding-text">
        <div class="finding-label">Mobile Optimisation</div>
        <div class="finding-detail">${mobileOk ? 'Mobile viewport configured.' : 'Not mobile-optimised — most emergency locksmith searches happen on a phone, so a mobile-friendly site matters.'}</div>
      </div>
    </div>

    <div class="finding-row">
      <div class="finding-icon ${hasTitleTag ? 'icon-pass' : 'icon-fail'}">${hasTitleTag ? '✓' : '✗'}</div>
      <div class="finding-text">
        <div class="finding-label">Page Title Tag</div>
        <div class="finding-detail">${hasTitleTag ? 'Title tag present.' : 'Missing or empty title tag — Google and AI engines use this as the primary signal for what the business does and where.'}</div>
      </div>
    </div>

    ${agencyMark ? `
    <div class="finding-row">
      <div class="finding-icon icon-warn">!</div>
      <div class="finding-text">
        <div class="finding-label">Third-Party Platform Watermark</div>
        <div class="finding-detail">${agencyMark} branding present. This can undermine trust with new customers and signals reliance on a lead-gen platform.</div>
      </div>
    </div>` : ''}
  </div>

  <!-- Online Presence Score (rendered from the stored, GBP-first breakdown) -->
  ${presenceBars && presenceScore !== null ? `
  <div class="card">
    <div class="card-title">Online Presence Score</div>
    <p style="font-size:13px;color:var(--muted);margin-bottom:20px">
      How strong this business looks across the signals that actually win local locksmith
      jobs — Google Business Profile, reviews, phone reachability, and the website that
      supports them. The bars show the strongest and weakest areas.
    </p>

    ${presenceBars.map((b) => {
      const pct = Math.round((b.strength / b.max) * 100);
      const color = pct >= 67 ? DATA_GREEN : pct >= 34 ? DATA_AMBER : DATA_BRICK;
      return `
    <div class="score-row">
      <div class="score-label">${b.label}</div>
      ${scoreBar(b.strength, b.max, color)}
      <div class="score-value" style="color:${color}">${pct}%</div>
    </div>`;
    }).join('')}

    <div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--line);display:flex;align-items:center;gap:16px">
      <div style="font-family:var(--font-mono);font-size:42px;font-weight:700;color:${presenceScore >= 67 ? DATA_GREEN : presenceScore >= 34 ? DATA_AMBER : DATA_BRICK}">${presenceScore}<span style="font-size:18px;color:var(--muted)">/100</span></div>
      <div style="font-size:14px;color:var(--muted)">
        ${presenceScore >= 67 ? 'Solid local presence. A few targeted fixes would tighten the lead well further.' :
          presenceScore >= 34 ? 'A workable base with clear gaps — the weakest bars above are where the quickest wins are.' :
          'Significant gaps in the signals that capture local jobs. The biggest levers are the lowest bars above.'}
      </div>
    </div>
  </div>` : ''}

  <!-- GBP Analysis -->
  <div class="card">
    <div class="card-title">Google Business Profile</div>

    <div class="finding-row">
      <div class="finding-icon ${gbpStatus === 'Claimed - Optimised' ? 'icon-pass' : gbpStatus === 'Claimed - Basic' ? 'icon-warn' : 'icon-fail'}">
        ${gbpStatus === 'Claimed - Optimised' ? '✓' : gbpStatus === 'Claimed - Basic' ? '~' : '✗'}
      </div>
      <div class="finding-text">
        <div class="finding-label">Profile Status</div>
        <div class="finding-detail">
          <span class="status-badge ${gbpStatus === 'Claimed - Optimised' ? 'badge-pass' : gbpStatus === 'Claimed - Basic' ? 'badge-warn' : 'badge-fail'}">${gbpStatus}</span>
          ${gbpStatus === 'Unclaimed' ? '<div style="margin-top:6px;font-size:13px;color:var(--muted)">An unclaimed profile means anyone can suggest edits, hours can be wrong, and the business has no control over its Maps presence.</div>' : ''}
        </div>
      </div>
    </div>

    ${gbpRating !== null ? `
    <div class="finding-row">
      <div class="finding-icon ${gbpRating >= 4.5 ? 'icon-pass' : gbpRating >= 3.5 ? 'icon-warn' : 'icon-fail'}">
        ${gbpRating >= 4.5 ? '✓' : gbpRating >= 3.5 ? '~' : '✗'}
      </div>
      <div class="finding-text">
        <div class="finding-label">Google Rating</div>
        <div class="finding-detail">${gbpRating} stars${gbpReviews !== null ? ` from ${gbpReviews} reviews` : ''}. ${gbpRating >= 4.5 ? 'Strong rating.' : 'Room to improve through a systematic review request process.'}</div>
      </div>
    </div>` : ''}

    ${gbpReviews !== null ? `
    <div class="finding-row">
      <div class="finding-icon ${gbpReviews >= 40 ? 'icon-pass' : gbpReviews >= 15 ? 'icon-warn' : 'icon-fail'}">
        ${gbpReviews >= 40 ? '✓' : gbpReviews >= 15 ? '~' : '✗'}
      </div>
      <div class="finding-text">
        <div class="finding-label">Review Count</div>
        <div class="finding-detail">${gbpReviews} reviews. ${gbpReviews >= 40 ? 'Competitive review volume.' : gbpReviews >= 15 ? 'Growing but below the 40+ threshold that dominates local Maps results.' : 'Low review count significantly reduces trust and Maps ranking for emergency searches.'}</div>
      </div>
    </div>` : ''}

    ${competitor ? `
    <div class="finding-row">
      <div class="finding-icon icon-warn">!</div>
      <div class="finding-text">
        <div class="finding-label">Top Competitor in ${city}</div>
        <div class="finding-detail">${competitor} is currently ranking above this business on Google Maps. Understanding what they do differently is the first step to taking that position.</div>
      </div>
    </div>` : ''}
  </div>

  <!-- Quick Wins -->
  ${quickWins.length > 0 ? `
  <div class="card">
    <div class="card-title">Quick Wins — Prioritised</div>
    <p style="font-size:13px;color:var(--muted);margin-bottom:16px">These changes have the highest impact on both Google ranking and AI search visibility.</p>
    ${quickWins.slice(0, 6).map((w, i) => `
    <div class="quick-win">
      <div class="qw-num">${i + 1}</div>
      <div>${w}</div>
    </div>`).join('')}
  </div>` : ''}

  <!-- CTA -->
  <div class="cta-section">
    <h2>Ready to fix this?</h2>
    <p>Strath Agency helps independent locksmiths win more local jobs from Google Maps and reviews. No long contracts, and honest about timing: answered calls can climb within weeks and Maps ranking typically moves over 1–3 months (it's capped by how close you are to the searcher). Reviews lift conversion straight away; broader search visibility is a 6–12 month build.</p>
    <a class="cta-btn" href="https://api.leadconnectorhq.com/widget/booking/GwjL8MDjGNohuN6zEYZR" target="_blank" rel="noopener noreferrer">Book a Free Call</a>
  </div>

  <div class="footer">
    <p class="footer-mono">Strath Agency · tyler@strathagency.com · Prepared exclusively for ${businessName}</p>
    <p style="margin-top:4px">© ${now} Strath Agency. This report is confidential and prepared solely for the named business.</p>
  </div>

</div>

<!-- Open tracking pixel -->
<img src="${trackingUrl}" width="1" height="1" style="display:none" alt="">

</body>
</html>`;
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const id = req.query.id as string | undefined;

  if (!id) {
    return res.status(400).send('Missing report ID');
  }

  // UUID format check
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return res.status(400).send('Invalid report ID');
  }

  const dbUrl = process.env.NEON_DATABASE_URL;
  if (!dbUrl) return res.status(500).send('DB not configured');

  try {
    const sql = neon(dbUrl);

    // Load prospect
    const rows = await sql`
      SELECT
        id, business_name, city, website_url,
        gbp_rating, gbp_review_count, gbp_status, gbp_url, gbp_categories,
        google_place_id, phone,
        icp_score, raw_score, icp_tier, score_breakdown,
        has_schema, has_faq, mobile_optimised, has_title_tag, has_h1,
        website_status, agency_watermark,
        observation_1, observation_2, nearest_competitor,
        town_ranks,
        ghl_contact_id,
        report_first_opened_at, report_open_count,
        entity_type
      FROM prospects
      WHERE id = ${id}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return res.status(404).send('Report not found');
    }

    const prospect = rows[0] as Record<string, unknown>;

    // Pixel mode — return tracking gif and update fields
    if (req.query.px === '1') {
      res.setHeader('Content-Type', 'image/gif');
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.end(TRACKING_PIXEL);

      // Fire-and-forget: update open tracking in Neon and GHL
      const now = new Date().toISOString();
      const currentCount = Number(prospect.report_open_count ?? 0);
      const isFirstOpen  = !prospect.report_first_opened_at;

      // Update Neon
      if (isFirstOpen) {
        await sql`UPDATE prospects SET report_first_opened_at = ${now}, report_last_opened_at = ${now}, report_open_count = 1 WHERE id = ${id}`;
      } else {
        await sql`UPDATE prospects SET report_last_opened_at = ${now}, report_open_count = ${currentCount + 1} WHERE id = ${id}`;
      }

      // Update GHL
      if (prospect.ghl_contact_id) {
        await updateGhlReportFields(String(prospect.ghl_contact_id), {
          firstOpen: isFirstOpen ? now : undefined,
          lastOpen: now,
          openCount: isFirstOpen ? 1 : currentCount + 1,
        });
      }

      return;
    }

    // Photo-proxy mode — stream the prospect's Google Business Profile photo.
    // The Places Photo URL embeds GOOGLE_PLACES_API_KEY, so it must NEVER reach the
    // client. We fetch it server-side and stream the bytes (we do not store the image).
    // Graceful: any miss returns 404 so the report's <img onerror> hides cleanly.
    if (req.query.photo === '1') {
      await streamPlacePhoto(res, prospect.google_place_id ? String(prospect.google_place_id) : null);
      return;
    }

    // Full report mode
    const baseUrl = process.env.REPORT_BASE_URL ?? `https://${req.headers.host}`;
    const trackingUrl = `${baseUrl}/api/report?id=${id}&px=1`;

    const html = renderReport(prospect, trackingUrl, baseUrl);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(html);

  } catch (err) {
    console.error('[report] Error:', err);
    return res.status(500).send('Error loading report');
  }
}
