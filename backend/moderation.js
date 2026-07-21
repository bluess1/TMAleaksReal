// Lightweight, dependency-free content filtering.
// This is a FIRST LINE OF DEFENSE only. It will not catch everything.
// The report system + admin panel are your real safety net -- check the
// admin panel regularly, especially in the first few weeks.

const PHONE_REGEX = /(\+?\d[\s.-]?){9,}/g;
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
// Common social handle patterns people use to dox / harass ("@someone on insta")
const HANDLE_LEAK_REGEX = /\b(ig|insta|instagram|snap(chat)?|tiktok)\s*[:@]\s*\S+/gi;

// Minimal slur/profanity starter list. Extend this yourself -- keep it in
// its own file so it's easy to update without touching server logic.
const BLOCKED_TERMS = [
  // Intentionally left mostly empty in this starter kit.
  // Add slurs, harassment terms, etc. here as lowercase strings.
];

function containsBlockedTerm(text) {
  const lower = text.toLowerCase();
  return BLOCKED_TERMS.some((term) => lower.includes(term));
}

/**
 * Checks text content for things we never want auto-approved:
 * phone numbers, emails, social handles paired with "leak" intent, and
 * blocked terms. Returns { ok: boolean, reason?: string, cleaned: string }
 */
function checkText(rawText) {
  const text = (rawText || '').trim();

  if (text.length > 2000) {
    return { ok: false, reason: 'Post too long (max 2000 characters).' };
  }

  if (PHONE_REGEX.test(text)) {
    return { ok: false, reason: 'Posts can\'t contain phone numbers.' };
  }

  if (EMAIL_REGEX.test(text)) {
    return { ok: false, reason: 'Posts can\'t contain email addresses.' };
  }

  if (HANDLE_LEAK_REGEX.test(text)) {
    return { ok: false, reason: 'Posts can\'t contain personal social media handles.' };
  }

  if (containsBlockedTerm(text)) {
    return { ok: false, reason: 'Post contains blocked language.' };
  }

  return { ok: true, cleaned: text };
}

module.exports = { checkText };
