// Strath Agency — Contact extraction from HTML
// Scrapes phone numbers and email addresses out of homepage HTML so the audit
// can recover contact info when the Places API didn't return it. Conservative
// — prefers explicit tel:/mailto: anchors, falls back to body-text regex.

// Email regex — body-text fallback. Excludes common image/font filenames.
const EMAIL_REGEX = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const EMAIL_BLOCKLIST = /\.(png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|eot|css|js)$/i;
const EMAIL_BLOCKED_LOCAL = /^(noreply|no-reply|donotreply|do-not-reply|abuse|postmaster|webmaster)@/i;

// UK phone regex — body-text fallback.
// Matches +44, 0, optional separators (space, hyphen, paren), 9-11 digits total.
// Filters out short codes and obviously-malformed numbers afterwards.
const PHONE_REGEX = /(?:\+44\s?|\(?0)\s?\d{1,5}\)?[\s.-]?\d{2,4}[\s.-]?\d{2,4}[\s.-]?\d{0,4}/g;

// tel: / mailto: anchors are explicit signals from the page author.
const TEL_HREF_REGEX = /href=["']tel:([^"']+)["']/gi;
const MAILTO_HREF_REGEX = /href=["']mailto:([^"'?]+)/gi;

function normalisePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, '');
  // Strip leading +44 → 0, then validate length
  let canonical = digits.startsWith('+44') ? '0' + digits.slice(3)
                : digits.startsWith('44') && digits.length >= 12 ? '0' + digits.slice(2)
                : digits;
  if (!canonical.startsWith('0')) return null;
  // UK landline+mobile are 10–11 digits including leading 0
  if (canonical.length < 10 || canonical.length > 11) return null;
  return canonical;
}

function isPlausibleEmail(addr: string): boolean {
  const lower = addr.toLowerCase();
  if (EMAIL_BLOCKLIST.test(lower)) return false;
  if (EMAIL_BLOCKED_LOCAL.test(lower)) return false;
  // Reject @example.com and @sentry.io type debug emails
  if (/@(example|test|localhost|sentry|wixpress|cloudflare|google-analytics)\./i.test(lower)) return false;
  return true;
}

export interface ExtractedContact {
  phone: string | null;
  email: string | null;
  source: { phone?: 'tel_href' | 'body_text'; email?: 'mailto_href' | 'body_text' };
}

export function extractContactFromHtml(html: string): ExtractedContact {
  const result: ExtractedContact = { phone: null, email: null, source: {} };

  // tel: anchors first — strongest signal
  const telMatch = TEL_HREF_REGEX.exec(html);
  TEL_HREF_REGEX.lastIndex = 0;
  if (telMatch?.[1]) {
    const norm = normalisePhone(telMatch[1]);
    if (norm) { result.phone = norm; result.source.phone = 'tel_href'; }
  }

  // mailto: anchors
  const mailMatch = MAILTO_HREF_REGEX.exec(html);
  MAILTO_HREF_REGEX.lastIndex = 0;
  if (mailMatch?.[1] && isPlausibleEmail(mailMatch[1])) {
    result.email = mailMatch[1].toLowerCase();
    result.source.email = 'mailto_href';
  }

  // Body-text fallback for phone — only if no tel: hit
  if (!result.phone) {
    PHONE_REGEX.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PHONE_REGEX.exec(html)) !== null) {
      const norm = normalisePhone(m[0]);
      if (norm) { result.phone = norm; result.source.phone = 'body_text'; break; }
    }
  }

  // Body-text fallback for email — only if no mailto: hit
  if (!result.email) {
    const matches = html.match(EMAIL_REGEX) ?? [];
    for (const e of matches) {
      if (isPlausibleEmail(e)) { result.email = e.toLowerCase(); result.source.email = 'body_text'; break; }
    }
  }

  return result;
}
