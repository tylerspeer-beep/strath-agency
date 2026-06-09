// Strath Agency — Per-town Map-Rank Library
// Powers the "rank on the map" report visual.
//
// Three concerns, kept as pure-ish units so they can be tested in isolation:
//   1. extractServedTowns(html, city) — parse a prospect's homepage nav/menu for the
//      towns/areas they claim to serve (the "10 town links" pattern). Falls back to
//      the prospect's city + a couple of nearby towns when no area links are found.
//   2. serperMapsSearch(query, key) — one Serper.dev Google-Maps/local-pack query.
//      Serper has free credits; callers MUST stay frugal (cap towns, one call/town).
//   3. scanTownRanks(...) — orchestrates: for each town, geocode the town centre once
//      (free, OSM Nominatim) for the map pin, run one Serper local query, and find the
//      prospect's rank by place_id (preferred) or business-name match.
//
// The result is cached in Neon (prospects.town_ranks) by the audit cron so we query
// Serper once per scan, never per report view. See migration_007 + api/report.ts.
//
// Env: SERPER_API_KEY (read by the caller and passed in — never hardcode a key here).

// ── Result shapes ───────────────────────────────────────────────────────────────

export interface TownRank {
  town: string;
  lat: number | null;        // town-centre latitude (OSM) — null if geocode failed
  lng: number | null;        // town-centre longitude (OSM)
  rank: number | null;       // prospect's position in the local pack, or null if not found
  found: boolean;            // true if the prospect appeared in the results at all
  matchedBy: 'place_id' | 'name' | null;
  topResult: string | null;  // who ranks #1 there (neutral context, never shown as a slight)
}

export interface TownRankScan {
  scannedAt: string;         // ISO timestamp — stamped by the caller (audit cron)
  keyword: string;           // the search phrase used, e.g. "auto locksmith"
  townSource: 'homepage_nav' | 'fallback';
  towns: TownRank[];
  totalTowns: number;
  foundCount: number;        // towns where the prospect appeared
  topThreeCount: number;     // towns where the prospect ranks 1–3
}

// ── Tunables ──────────────────────────────────────────────────────────────────
export const MAX_TOWNS = 8;            // cost cap — one Serper call per town
const SERPER_MAPS_URL = 'https://google.serper.dev/maps';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
const GEO_UA = 'StrathAuditBot/1.0 (tyler@strathagency.com)';

// ── Town extraction ─────────────────────────────────────────────────────────────

// href path fragments that signal an "areas we cover" / town-page link.
const AREA_PATH_HINTS = [
  'service-area', 'service-areas', 'serviceareas', 'areas', 'area',
  'locations', 'location', 'towns', 'town', 'where-we-work', 'where-we-cover',
  'coverage', 'covered', 'regions', 'region', 'places', 'we-cover', 'cover',
];

// Words that look like town links but aren't — page chrome, services, CTAs.
const TOWN_STOPWORDS = new Set([
  'home', 'about', 'about us', 'contact', 'contact us', 'services', 'service',
  'our services', 'blog', 'news', 'faq', 'faqs', 'reviews', 'testimonials',
  'gallery', 'prices', 'pricing', 'quote', 'get a quote', 'book', 'book now',
  'call', 'call us', 'email', 'menu', 'privacy', 'privacy policy', 'terms',
  'terms and conditions', 'cookies', 'cookie policy', 'login', 'log in',
  'sitemap', 'careers', 'team', 'meet the team', 'why us', 'how it works',
  'areas we cover', 'areas', 'service areas', 'coverage', 'locations',
  'commercial', 'residential', 'automotive', 'emergency', 'auto', 'domestic',
  'car keys', 'car key', 'key cutting', 'lock fitting', 'safes', 'uPVC',
  'read more', 'learn more', 'more', 'view all', 'all areas', 'next', 'previous',
]);

const HAS_LETTERS = /[a-z]/i;
// A plausible UK town/area name: letters, spaces, hyphens, apostrophes, &; 1–3 words.
const TOWN_NAME_RE = /^[a-z][a-z .'&\-]{1,38}$/i;
const SERVICE_WORDS = /\b(locksmith|locks?|key|keys|security|safe|safes|alarm|cctv|joiner|glaz|window|door)\b/i;

function stripTags(s: string): string {
  return s.replace(/<[^>]*>/g, ' ').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

// Title-case a slug ("east-kilbride" → "East Kilbride"), dropping trailing
// "-locksmith"-style service words.
function slugToTown(slug: string): string | null {
  const raw = decodeURIComponent(slug).replace(/\.(html?|php|aspx?)$/i, '');
  const parts = raw.split(/[-_]/).filter(Boolean)
    .filter((w) => !SERVICE_WORDS.test(w));
  if (parts.length === 0 || parts.length > 4) return null;
  const name = parts.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  return TOWN_NAME_RE.test(name) ? name : null;
}

function looksLikeTown(text: string): boolean {
  const t = text.trim();
  if (!t || !HAS_LETTERS.test(t)) return false;
  if (TOWN_STOPWORDS.has(t.toLowerCase())) return false;
  if (SERVICE_WORDS.test(t)) return false;
  if (!TOWN_NAME_RE.test(t)) return false;
  return t.split(/\s+/).length <= 3;
}

function normTown(s: string): string {
  return s.toLowerCase().replace(/[^a-z]/g, '');
}

// Curated nearby-town fallback for our target cities (free, no geocode needed to
// pick names). Used only when the homepage exposes no area links.
const NEARBY_TOWNS: Record<string, string[]> = {
  glasgow:       ['Paisley', 'East Kilbride', 'Hamilton', 'Clydebank'],
  edinburgh:     ['Livingston', 'Dalkeith', 'Musselburgh', 'Bonnyrigg'],
  aberdeen:      ['Westhill', 'Stonehaven', 'Inverurie', 'Peterhead'],
  dundee:        ['Broughty Ferry', 'Monifieth', 'Carnoustie', 'Arbroath'],
  inverness:     ['Nairn', 'Dingwall', 'Beauly', 'Fortrose'],
  stirling:      ['Falkirk', 'Alloa', 'Dunblane', 'Bridge of Allan'],
  falkirk:       ['Grangemouth', 'Larbert', 'Stirling', 'Bo\'ness'],
  hamilton:      ['Motherwell', 'East Kilbride', 'Bellshill', 'Wishaw'],
  livingston:    ['Bathgate', 'Broxburn', 'Whitburn', 'Armadale'],
  perth:         ['Scone', 'Crieff', 'Blairgowrie', 'Auchterarder'],
  paisley:       ['Renfrew', 'Johnstone', 'Barrhead', 'Glasgow'],
  kilmarnock:    ['Irvine', 'Kilwinning', 'Ayr', 'Stewarton'],
  'east kilbride': ['Hamilton', 'Glasgow', 'Rutherglen', 'Carmunnock'],
};

// Parse homepage HTML for served towns. Returns at most MAX_TOWNS, always including
// the prospect's own city first.
export function extractServedTowns(
  html: string,
  city: string
): { towns: string[]; source: 'homepage_nav' | 'fallback' } {
  const anchorRe = /<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const found: string[] = [];
  const seen = new Set<string>();

  const push = (name: string | null) => {
    if (!name) return;
    const trimmed = name.trim();
    // Final gate — reject page chrome / service words however the name was derived
    // (anchor text or URL slug), and enforce the town-name shape.
    if (TOWN_STOPWORDS.has(trimmed.toLowerCase()) || SERVICE_WORDS.test(trimmed)) return;
    if (!TOWN_NAME_RE.test(trimmed)) return;
    const key = normTown(trimmed);
    if (!key || seen.has(key)) return;
    seen.add(key);
    found.push(trimmed);
  };

  let m: RegExpExecArray | null;
  while ((m = anchorRe.exec(html)) !== null) {
    const href = m[1].toLowerCase();
    const text = stripTags(m[2]);

    // Path segments of the href, e.g. /areas/east-kilbride → ['areas','east-kilbride']
    const segs = href.replace(/^https?:\/\/[^/]+/, '').split('/').filter(Boolean);
    const hintIdx = segs.findIndex((s) => AREA_PATH_HINTS.includes(s));
    const isAreaPath = hintIdx !== -1;

    if (isAreaPath) {
      // Prefer the visible anchor text; fall back to the slug after the hint.
      if (looksLikeTown(text)) {
        push(text);
      } else {
        const slugSeg = segs[hintIdx + 1] ?? segs[segs.length - 1];
        if (slugSeg && !AREA_PATH_HINTS.includes(slugSeg)) push(slugToTown(slugSeg));
      }
    }
  }

  // The "10 town links" pattern is only trustworthy when several area links exist.
  if (found.length >= 2) {
    return { towns: withCityFirst(found, city).slice(0, MAX_TOWNS), source: 'homepage_nav' };
  }

  // Fallback: prospect's city + curated nearby towns.
  const nearby = NEARBY_TOWNS[city.toLowerCase().trim()] ?? [];
  return { towns: withCityFirst(nearby, city).slice(0, MAX_TOWNS), source: 'fallback' };
}

// Ensure the prospect's own city is present and listed first, then the rest.
function withCityFirst(towns: string[], city: string): string[] {
  const cityKey = normTown(city);
  const rest = towns.filter((t) => normTown(t) !== cityKey);
  return cityKey ? [city.trim(), ...rest] : rest;
}

// ── Name matching ────────────────────────────────────────────────────────────────

const LEGAL_SUFFIX = /\b(ltd|limited|llp|plc|co|company|services?|solutions?|group)\b/gi;

function normBiz(s: string): string {
  return s.toLowerCase().replace(LEGAL_SUFFIX, '').replace(/[^a-z0-9]/g, '').trim();
}

// True if two business names plausibly refer to the same business.
function nameMatches(a: string, b: string): boolean {
  const na = normBiz(a);
  const nb = normBiz(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  // Substring either direction (handles "Smith Locks" vs "Smith Locksmith Glasgow").
  return na.length >= 5 && nb.length >= 5 && (na.includes(nb) || nb.includes(na));
}

// ── Serper Maps search ───────────────────────────────────────────────────────────

interface SerperPlace {
  position?: number;
  title?: string;
  placeId?: string;
  cid?: string;
  latitude?: number;
  longitude?: number;
}

export async function serperMapsSearch(
  query: string,
  serperKey: string,
  ll?: { lat: number; lng: number }
): Promise<SerperPlace[]> {
  const body: Record<string, unknown> = { q: query, gl: 'gb', hl: 'en' };
  // Bias the local pack toward the town centre when we have its coordinates.
  if (ll) body.ll = `@${ll.lat},${ll.lng},13z`;

  const res = await fetch(SERPER_MAPS_URL, {
    method: 'POST',
    headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Serper ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = (await res.json()) as { places?: SerperPlace[] };
  return data.places ?? [];
}

// Find the prospect's rank within a Serper places list.
function rankInPlaces(
  places: SerperPlace[],
  prospect: { placeId?: string; businessName: string }
): { rank: number; matchedBy: 'place_id' | 'name' } | null {
  for (let i = 0; i < places.length; i++) {
    const p = places[i];
    if (prospect.placeId && p.placeId && p.placeId === prospect.placeId) {
      return { rank: p.position ?? i + 1, matchedBy: 'place_id' };
    }
  }
  for (let i = 0; i < places.length; i++) {
    const p = places[i];
    if (p.title && nameMatches(p.title, prospect.businessName)) {
      return { rank: p.position ?? i + 1, matchedBy: 'name' };
    }
  }
  return null;
}

// ── Town-centre geocoding (free, OSM Nominatim) ──────────────────────────────────

async function geocodeTown(town: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const url = `${NOMINATIM_URL}?q=${encodeURIComponent(town + ', UK')}&format=json&limit=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': GEO_UA, 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const arr = (await res.json()) as { lat: string; lon: string }[];
    if (!arr[0]) return null;
    return { lat: parseFloat(arr[0].lat), lng: parseFloat(arr[0].lon) };
  } catch {
    return null;
  }
}

// ── Orchestrator ─────────────────────────────────────────────────────────────────

export interface ScanInput {
  towns: string[];
  townSource: 'homepage_nav' | 'fallback';
  keyword: string;             // e.g. "auto locksmith"
  businessName: string;
  placeId?: string;            // prospect's Google place_id (preferred match key)
  serperKey: string;
}

// Runs one geocode + one Serper query per town (sequentially, to respect OSM's
// 1 req/s policy and keep Serper usage predictable). Returns the full scan.
export async function scanTownRanks(input: ScanInput): Promise<TownRankScan> {
  const towns: TownRank[] = [];

  for (const town of input.towns) {
    const geo = await geocodeTown(town);
    // Nominatim asks for <= 1 request/second.
    await new Promise((r) => setTimeout(r, 1100));

    let rank: number | null = null;
    let found = false;
    let matchedBy: 'place_id' | 'name' | null = null;
    let topResult: string | null = null;

    try {
      const query = `${input.keyword} ${town}`;
      const places = await serperMapsSearch(query, input.serperKey, geo ?? undefined);
      topResult = places[0]?.title ?? null;
      const hit = rankInPlaces(places, { placeId: input.placeId, businessName: input.businessName });
      if (hit) {
        rank = hit.rank;
        matchedBy = hit.matchedBy;
        found = true;
      }
    } catch (err) {
      console.error(`[town-rank] Serper query failed for "${town}":`, err);
    }

    towns.push({
      town,
      lat: geo?.lat ?? null,
      lng: geo?.lng ?? null,
      rank,
      found,
      matchedBy,
      topResult,
    });
  }

  const foundCount = towns.filter((t) => t.found).length;
  const topThreeCount = towns.filter((t) => t.rank !== null && t.rank <= 3).length;

  return {
    scannedAt: new Date().toISOString(),
    keyword: input.keyword,
    townSource: input.townSource,
    towns,
    totalTowns: towns.length,
    foundCount,
    topThreeCount,
  };
}
