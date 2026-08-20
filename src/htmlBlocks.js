// Article HTML -> a flat list of neutral blocks.
//
// Written as a small tokenizer rather than DOMParser so the same code runs in
// the browser and under node in tests, and so the .docx export cannot silently
// drop content the way the old "rename .doc and hope Word copes" export did.
//
// Handles the tags the generator actually emits: h1-h4, p, ul/ol/li, strong/b,
// em/i, a, figure/img/figcaption, table/tr/td/th, br.

const ENTITIES = {
  lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: "\u00A0",
  hellip: "\u2026", mdash: "\u2014", ndash: "\u2013",
  rsquo: "\u2019", lsquo: "\u2018", ldquo: "\u201C", rdquo: "\u201D",
  middot: "\u00B7", bull: "\u2022", pound: "\u00A3", euro: "\u20AC", deg: "\u00B0",
};

export const decodeEntities = (s) =>
  String(s ?? "")
    .replace(/&([a-z]+|#\d+);/gi, (m, k) => ENTITIES[k.toLowerCase()] ?? m)
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    // "&amp;" last so "&amp;lt;" does not decode twice
    .replace(/&amp;/gi, "&");

const parseAttrs = (tag) => {
  const out = {};
  const re = /([a-zA-Z_:][-\w:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/g;
  let m;
  while ((m = re.exec(tag))) out[m[1].toLowerCase()] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  return out;
};

const HEADING = /^h([1-6])$/i;

/**
 * @returns {Array} blocks:
 *   { type:"heading", level, runs }
 *   { type:"paragraph", runs }
 *   { type:"listItem", ordered, level, runs }
 *   { type:"image", src, alt, caption }
 *   { type:"table", rows:[[{ runs, header }]] }
 * A run is { text, bold, italic, link }.
 */
export const htmlToBlocks = (html) => {
  const blocks = [];
  const lists = [];              // stack of { ordered }
  let bold = 0, italic = 0, link = null;
  let block = null;              // current non-table block
  let table = null, row = null, cell = null;
  let skip = 0;                  // inside script/style
  let figure = 0;                // inside <figure>, so a caption can attach
  let inCaption = false;

  const target = () => (cell ? cell.runs : block ? block.runs : null);

  const addText = (raw) => {
    const text = decodeEntities(raw).replace(/\s+/g, " ");
    if (!text) return;
    if (!cell && !block) {
      // Loose text outside any block still belongs in the document
      block = { type: "paragraph", runs: [] };
    }
    const runs = target();
    const last = runs[runs.length - 1];
    if (last && last.bold === !!bold && last.italic === !!italic && last.link === link) {
      last.text += text;
    } else {
      runs.push({ text, bold: !!bold, italic: !!italic, link });
    }
  };

  const flush = () => {
    if (!block) return;
    const hasText = block.runs.some(r => r.text.trim());
    if (hasText) {
      // Trim the edges so Word does not render stray leading spaces
      block.runs[0].text = block.runs[0].text.replace(/^\s+/, "");
      const last = block.runs[block.runs.length - 1];
      last.text = last.text.replace(/\s+$/, "");
      blocks.push(block);
    }
    block = null;
  };

  const open = (type, extra) => { flush(); block = { type, runs: [], ...extra }; };

  for (const token of String(html || "").split(/(<[^>]+>)/)) {
    if (!token) continue;

    if (!(token.startsWith("<") && token.endsWith(">"))) {
      if (!skip) addText(token);
      continue;
    }

    const closing = token[1] === "/";
    const name = (token.match(/^<\/?\s*([a-zA-Z0-9]+)/) || [])[1]?.toLowerCase();
    if (!name) continue;

    if (name === "script" || name === "style") { skip += closing ? -1 : 1; if (skip < 0) skip = 0; continue; }
    if (skip) continue;

    const attrs = closing ? {} : parseAttrs(token);

    if (HEADING.test(name)) {
      if (closing) flush();
      else open("heading", { level: Math.min(4, Number(name[1])) });
      continue;
    }

    switch (name) {
      case "p": case "div": case "blockquote":
        if (closing) flush(); else open("paragraph");
        break;

      case "br":
        if (target()) addText(" ");
        break;

      case "strong": case "b":
        bold += closing ? -1 : 1; if (bold < 0) bold = 0;
        break;
      case "em": case "i":
        italic += closing ? -1 : 1; if (italic < 0) italic = 0;
        break;

      case "a":
        link = closing ? null : (attrs.href || null);
        break;

      case "ul": case "ol":
        flush();
        if (closing) lists.pop();
        else lists.push({ ordered: name === "ol" });
        break;

      case "li":
        if (closing) flush();
        else open("listItem", {
          ordered: !!lists[lists.length - 1]?.ordered,
          level: Math.max(0, lists.length - 1),
        });
        break;

      case "figure":
        figure += closing ? -1 : 1; if (figure < 0) figure = 0;
        if (closing) flush();
        break;

      case "figcaption":
        if (closing) {
          inCaption = false;
          // Attach the caption to the image it belongs to instead of leaving
          // a stray paragraph after it
          const text = block ? block.runs.map(r => r.text).join("").trim() : "";
          block = null;
          const prev = blocks[blocks.length - 1];
          if (text && prev?.type === "image") prev.caption = text;
          else if (text) blocks.push({ type: "paragraph", runs: [{ text, bold: false, italic: true, link: null }] });
        } else {
          flush();
          inCaption = true;
          block = { type: "paragraph", runs: [] };
        }
        break;

      case "img":
        if (!closing && attrs.src) {
          flush();
          blocks.push({ type: "image", src: attrs.src, alt: attrs.alt || "", caption: "" });
        }
        break;

      case "table":
        if (closing) {
          if (table && table.rows.length) blocks.push(table);
          table = null;
        } else { flush(); table = { type: "table", rows: [] }; }
        break;

      case "tr":
        if (closing) { if (table && row) table.rows.push(row); row = null; }
        else row = [];
        break;

      case "td": case "th":
        if (closing) { if (row && cell) row.push(cell); cell = null; }
        else cell = { runs: [], header: name === "th" };
        break;

      default:
        break;
    }
  }

  flush();
  if (table && table.rows.length) blocks.push(table);
  void inCaption; void figure;
  return blocks;
};

/** Every image src in document order — what the caller must download. */
export const imageSources = (blocks) =>
  [...new Set(blocks.filter(b => b.type === "image").map(b => b.src))];
