// Post-processing that turns Grok's raw HTML into a finished SEO article:
// real word counts, a detectable FAQ block, bolded target keywords and images
// that are actually present in the markup. Kept React-free so it can be tested.

const SKIP_TAGS = /^(h[1-6]|strong|b|em|i|a|figure|figcaption|script|style|code|pre|blockquote)$/i;

/** Minimum length we accept before asking the model to expand the article. */
export const MIN_WORDS = 2000;

export const stripHtml = (html) =>
  String(html || "")
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&(?:[a-z]+|#\d+);/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Words the reader actually sees — tags, entities and stray punctuation excluded. */
export const countWords = (html) => {
  const text = stripHtml(html);
  if (!text) return 0;
  return text.split(" ").filter(w => /[\p{L}\p{N}]/u.test(w)).length;
};

// ─── FAQ ──────────────────────────────────────────────────────────
const FAQ_HEADING = /<h[1-4][^>]*>[^<]*?(?:faq|frequently\s+asked|q\s*&(?:amp;)?\s*a|common\s+questions)[^<]*<\/h[1-4]>/i;

export const hasFaqSection = (html) => FAQ_HEADING.test(String(html || ""));

/**
 * Question/answer pairs from the FAQ block, for schema markup. Handles the two
 * shapes the model produces: <h3>question</h3><p>answer</p>, and a bolded
 * question inside its own paragraph.
 */
export const extractFaqPairs = (html) => {
  const src = String(html || "");
  const head = src.match(FAQ_HEADING);
  if (!head) return [];

  const after = src.slice(head.index + head[0].length);
  const nextH2 = after.search(/<h2[\s>]/i);
  const section = nextH2 === -1 ? after : after.slice(0, nextH2);
  const pairs = [];

  const byHeading = /<h[34][^>]*>([\s\S]*?)<\/h[34]>([\s\S]*?)(?=<h[34][\s>]|$)/gi;
  let m;
  while ((m = byHeading.exec(section))) {
    const q = stripHtml(m[1]);
    const a = stripHtml(m[2]);
    if (q && a) pairs.push({ q, a });
  }
  if (pairs.length) return pairs;

  const byBold = /<p[^>]*>\s*<strong[^>]*>([\s\S]*?)<\/strong>\s*<\/p>\s*<p[^>]*>([\s\S]*?)<\/p>/gi;
  while ((m = byBold.exec(section))) {
    const q = stripHtml(m[1]);
    const a = stripHtml(m[2]);
    if (q && a) pairs.push({ q, a });
  }
  return pairs;
};

/** FAQPage JSON-LD so the Q&A can win a rich result. Empty string if too thin. */
export const buildFaqSchema = (pairs) => {
  const clean = (pairs || []).filter(p => p && p.q && p.a);
  if (clean.length < 2) return "";
  const json = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: clean.map(p => ({
      "@type": "Question",
      name: p.q,
      acceptedAnswer: { "@type": "Answer", text: p.a },
    })),
  };
  // Escaping "<" keeps a stray "</script>" in an answer from closing the tag
  return `\n<script type="application/ld+json">${JSON.stringify(json).replace(/</g, "\\u003c")}</script>`;
};

/** Append new sections before the FAQ so the Q&A stays the last block. */
export const insertBeforeFaq = (html, addition) => {
  const src = String(html || "");
  const extra = String(addition || "").trim();
  if (!extra) return src;
  const head = src.match(FAQ_HEADING);
  if (!head) return src + "\n" + extra;
  return src.slice(0, head.index) + extra + "\n" + src.slice(head.index);
};

// ─── Keyword emphasis ─────────────────────────────────────────────
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Word boundaries only where the term starts/ends with a word character, so
// terms like "24/7 transfers" or "(Pvt) tours" still match.
const termRe = (term) =>
  new RegExp(
    `${/^[\p{L}\p{N}]/u.test(term) ? "\\b" : ""}${escapeRe(term)}${/[\p{L}\p{N}]$/u.test(term) ? "\\b" : ""}`,
    "giu"
  );

/**
 * Wrap target keywords in <strong> in body copy only — never inside headings,
 * links, or text that is already emphasised, and never more than `perKeyword`
 * times each so it reads naturally instead of like keyword stuffing.
 */
export const boldKeywords = (html, keywords = [], { perKeyword = 2 } = {}) => {
  const terms = [...new Set((keywords || []).map(k => String(k || "").trim()).filter(k => k.length > 2))]
    .sort((a, b) => b.length - a.length); // longest first so the fuller phrase wins

  const source = String(html || "");
  if (!terms.length || !source) return { html: source, bolded: 0, terms: [] };

  const quota = new Map(terms.map(t => [t, perKeyword]));
  const used = new Set();
  let bolded = 0;
  let skip = 0;

  const out = source.split(/(<[^>]+>)/).map(seg => {
    if (seg.startsWith("<") && seg.endsWith(">")) {
      const tag = (seg.match(/^<\/?([a-z0-9]+)/i) || [])[1] || "";
      if (SKIP_TAGS.test(tag) && !seg.endsWith("/>")) skip += seg[1] === "/" ? -1 : 1;
      if (skip < 0) skip = 0;
      return seg;
    }
    if (skip > 0 || !seg.trim()) return seg;

    // Collect non-overlapping spans first, then rewrite right-to-left so the
    // inserted tags never get rescanned as if they were body text.
    const marks = [];
    for (const t of terms) {
      if (quota.get(t) <= 0) continue;
      const re = termRe(t);
      let m;
      while ((m = re.exec(seg)) !== null && quota.get(t) > 0) {
        const s = m.index;
        const e = s + m[0].length;
        if (e === s) break;
        if (marks.some(k => s < k.e && e > k.s)) continue;
        marks.push({ s, e });
        quota.set(t, quota.get(t) - 1);
        used.add(t);
        bolded++;
      }
    }
    if (!marks.length) return seg;

    marks.sort((a, b) => b.s - a.s);
    let str = seg;
    for (const k of marks) {
      str = `${str.slice(0, k.s)}<strong>${str.slice(k.s, k.e)}</strong>${str.slice(k.e)}`;
    }
    return str;
  }).join("");

  return { html: out, bolded, terms: [...used] };
};

// ─── Images ───────────────────────────────────────────────────────
const figure = (img) =>
  `<figure style="margin:28px 0"><img src="${img.url}" alt="${String(img.alt || "").replace(/"/g, "&quot;")}" loading="lazy" style="width:100%;max-height:420px;object-fit:cover;border-radius:12px"/>` +
  `<figcaption style="text-align:center;font-size:12px;color:#888;margin-top:8px">${img.credit || ""}</figcaption></figure>`;

/**
 * Spread images through the article. Tries H2 boundaries, then H3, then
 * paragraphs, and falls back to top-and-tail — an image that was fetched is
 * always placed somewhere rather than silently dropped, which is what the old
 * H2-only version did whenever the model returned a differently shaped article.
 * Returns the number actually inserted so the log can tell the truth.
 */
export const insertImages = (html, images) => {
  const src = String(html || "");
  const list = (images || []).filter(i => i && i.url && !src.includes(i.url));
  if (!list.length) return { html: src, inserted: 0 };

  const points = (re) => [...src.matchAll(re)].map(m => m.index + m[0].length);
  let anchors = points(/<\/h2>/gi);
  if (anchors.length < 2) anchors = points(/<\/h3>/gi);
  if (anchors.length < 2) anchors = points(/<\/p>/gi);

  if (!anchors.length) {
    // No recognisable structure — still show every image
    return { html: list.map(figure).join("\n") + "\n" + src, inserted: list.length };
  }

  const placements = list.map((img, i) => ({
    at: anchors[Math.min(anchors.length - 1, Math.floor((i * anchors.length) / list.length))],
    img,
  }));

  // Insert back-to-front so earlier offsets stay valid
  let out = src;
  const seen = new Set();
  let inserted = 0;
  for (let i = placements.length - 1; i >= 0; i--) {
    const { at, img } = placements[i];
    // Two images at one anchor would stack; nudge duplicates to the end instead
    const pos = seen.has(at) ? out.length : at;
    seen.add(at);
    out = out.slice(0, pos) + "\n" + figure(img) + "\n" + out.slice(pos);
    inserted++;
  }
  return { html: out, inserted };
};

/** Everything the pipeline log and the UI need to show about a finished article. */
export const seoReport = (html, keywords = []) => {
  const src = String(html || "");
  const text = stripHtml(src).toLowerCase();
  return {
    words: countWords(src),
    images: (src.match(/<img[\s>]/gi) || []).length,
    h2: (src.match(/<h2[\s>]/gi) || []).length,
    faq: extractFaqPairs(src).length,
    bold: (src.match(/<strong[\s>]/gi) || []).length,
    keywordsPresent: (keywords || []).filter(k => k && text.includes(String(k).toLowerCase())).length,
  };
};
