// Keeps generated articles on a single brand: the client's own name and site.
// Grok is told which names are off-limits, and anything that slips through is
// rewritten before the article is stored or published.

// Brands baked into earlier versions of this app that must never appear in a
// different client's article.
export const LEGACY_BRANDS = [{ name: "Wonders of Lanka", website: "wondersoflanka.com" }];

/** "https://www.Foo.com/bar" -> "foo.com" */
export const normalizeDomain = (url) =>
  String(url || "")
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./i, "")
    .replace(/[/?#].*$/, "")
    .toLowerCase();

/**
 * Every brand name and domain that must not appear in this client's articles:
 * all other clients, plus the legacy defaults. The active brand is excluded so
 * it is never rewritten into itself.
 */
export const collectForbiddenBrands = ({
  clients = [],
  activeClientId = "",
  activeName = "",
  activeWebsite = "",
} = {}) => {
  const activeN = String(activeName || "").trim().toLowerCase();
  const activeW = normalizeDomain(activeWebsite);
  const out = [];

  const add = (name, website) => {
    const n = String(name || "").trim();
    const w = normalizeDomain(website);
    if (n && n.toLowerCase() !== activeN) out.push(n);
    if (w && w !== activeW) out.push(w);
  };

  clients.filter(c => c && c.id !== activeClientId).forEach(c => add(c.name, c.website));
  LEGACY_BRANDS.forEach(b => add(b.name, b.website));

  // Longest first so "Alpha Travel Ltd" is replaced before "Alpha Travel"
  return [...new Set(out.filter(Boolean))].sort((a, b) => b.length - a.length);
};

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Rewrite any forbidden brand mention to the active brand. Domains are matched
 * anywhere (they appear inside URLs); names are matched on word boundaries.
 * If the active brand has no equivalent value, the text is left alone rather
 * than blanked out.
 */
export const enforceBrand = (html, { name = "", website = "" } = {}, forbidden = []) => {
  let out = String(html || "");
  let replaced = 0;
  const hits = [];

  for (const term of forbidden) {
    if (!term) continue;
    const isDomain = term.includes(".");
    const replacement = isDomain ? normalizeDomain(website) : String(name || "").trim();
    if (!replacement) continue;

    // Word boundaries only where the term actually starts/ends with a word
    // character — "\b" cannot match after a ")", so names like
    // "Foo Travel (Pvt) Ltd" would otherwise never be replaced.
    const pattern = isDomain
      ? escapeRe(term)
      : `${/^\w/.test(term) ? "\\b" : ""}${escapeRe(term)}${/\w$/.test(term) ? "\\b" : ""}`;
    const re = new RegExp(pattern, "gi");
    let termCount = 0;
    out = out.replace(re, () => { termCount++; return replacement; });
    if (termCount) { replaced += termCount; hits.push(term); }
  }

  return { html: out, replaced, terms: hits };
};
