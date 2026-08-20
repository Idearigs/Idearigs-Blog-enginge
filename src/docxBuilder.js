// Blocks -> a real .docx (OOXML) document.
//
// The old export wrote an HTML file named ".doc" with images as data: URIs.
// Word does not load data: URIs from imported HTML, which is why every
// downloaded article arrived with no pictures. Here the image bytes are packed
// into the document itself, so they travel with the file.

import {
  Document, Packer, Paragraph, TextRun, ImageRun, ExternalHyperlink,
  Table, TableRow, TableCell, HeadingLevel, AlignmentType, WidthType,
  BorderStyle, ShadingType,
} from "docx";

/** Page text width at A4 with 2cm margins, in pixels at 96dpi. */
export const MAX_IMAGE_WIDTH = 600;

const NAVY = "1A365D";
const BLUE = "2C5282";
const MID  = "2B6CB0";
const GREY = "718096";

/** Fit an image inside the text column, preserving its aspect ratio. */
export const fitImage = (width, height, max = MAX_IMAGE_WIDTH) => {
  const w = Number(width) > 0 ? Number(width) : max;
  const h = Number(height) > 0 ? Number(height) : Math.round(max * 0.6);
  if (w <= max) return { width: Math.round(w), height: Math.round(h) };
  return { width: max, height: Math.max(1, Math.round((h / w) * max)) };
};

/** docx needs the format name, not a MIME type. */
export const imageType = (mime = "", src = "") => {
  const s = `${mime} ${src}`.toLowerCase();
  if (s.includes("png")) return "png";
  if (s.includes("gif")) return "gif";
  if (s.includes("bmp")) return "bmp";
  return "jpg";
};

const toRuns = (runs = [], { size, color, bold: forceBold } = {}) =>
  runs.flatMap(r => {
    const run = new TextRun({
      text: r.text,
      bold: forceBold || r.bold || undefined,
      italics: r.italic || undefined,
      size, color,
    });
    if (!r.link) return [run];
    return [new ExternalHyperlink({ children: [
      new TextRun({ text: r.text, bold: r.bold || undefined, italics: r.italic || undefined, size, style: "Hyperlink" }),
    ], link: r.link })];
  });

const HEADINGS = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
  4: HeadingLevel.HEADING_4,
};

const cellParagraphs = (cell) =>
  [new Paragraph({ children: toRuns(cell.runs, { size: 20, bold: cell.header }), spacing: { before: 60, after: 60 } })];

const buildTable = (block) => {
  const width = Math.max(1, ...block.rows.map(r => r.length));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top:    { style: BorderStyle.SINGLE, size: 4, color: "CBD5E0" },
      bottom: { style: BorderStyle.SINGLE, size: 4, color: "CBD5E0" },
      left:   { style: BorderStyle.SINGLE, size: 4, color: "CBD5E0" },
      right:  { style: BorderStyle.SINGLE, size: 4, color: "CBD5E0" },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: "E2E8F0" },
      insideVertical:   { style: BorderStyle.SINGLE, size: 4, color: "E2E8F0" },
    },
    rows: block.rows.map(row => new TableRow({
      children: Array.from({ length: width }, (_, i) => {
        const cell = row[i] || { runs: [], header: false };
        return new TableCell({
          children: cellParagraphs(cell),
          shading: cell.header ? { type: ShadingType.CLEAR, fill: "EDF2F7" } : undefined,
          margins: { top: 60, bottom: 60, left: 100, right: 100 },
        });
      }),
    })),
  });
};

/**
 * @param images Map<src, { data, width, height, mime }>. A src that is missing
 *               or failed to download degrades to a visible placeholder line
 *               rather than silently vanishing.
 */
const blockToElements = (block, images) => {
  switch (block.type) {
    case "heading":
      return [new Paragraph({
        children: toRuns(block.runs),
        heading: HEADINGS[block.level] || HeadingLevel.HEADING_3,
        spacing: { before: block.level <= 2 ? 320 : 240, after: 120 },
      })];

    case "listItem":
      return [new Paragraph({
        children: toRuns(block.runs),
        spacing: { before: 40, after: 40 },
        ...(block.ordered
          ? { numbering: { reference: "article-ordered", level: Math.min(2, block.level) } }
          : { bullet: { level: Math.min(2, block.level) } }),
      })];

    case "image": {
      const img = images?.get?.(block.src);
      if (!img?.data) {
        return [new Paragraph({
          children: [new TextRun({ text: `[image unavailable: ${block.alt || block.src}]`, italics: true, color: GREY, size: 18 })],
          alignment: AlignmentType.CENTER,
          spacing: { before: 160, after: 160 },
        })];
      }
      const { width, height } = fitImage(img.width, img.height);
      const out = [new Paragraph({
        children: [new ImageRun({
          type: imageType(img.mime, block.src),
          data: img.data,
          transformation: { width, height },
          altText: block.alt ? { title: block.alt, description: block.alt, name: block.alt } : undefined,
        })],
        alignment: AlignmentType.CENTER,
        spacing: { before: 200, after: block.caption ? 40 : 200 },
      })];
      if (block.caption) {
        out.push(new Paragraph({
          children: [new TextRun({ text: block.caption, italics: true, color: GREY, size: 16 })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 200 },
        }));
      }
      return out;
    }

    case "table":
      // Word merges adjacent tables that are not separated by a paragraph
      return [buildTable(block), new Paragraph({ text: "", spacing: { after: 120 } })];

    default:
      return [new Paragraph({ children: toRuns(block.runs), spacing: { before: 80, after: 80 }, alignment: AlignmentType.LEFT })];
  }
};

const metaLine = (label, value) =>
  new Paragraph({
    children: [
      new TextRun({ text: `${label}: `, bold: true, color: BLUE, size: 18 }),
      new TextRun({ text: String(value || "—"), size: 18, color: "4A5568" }),
    ],
    spacing: { after: 40 },
  });

/**
 * Build the document for one article.
 * @returns a docx Document ready for Packer.
 */
export const buildArticleDoc = ({ article = {}, blocks = [], images, meta = {} } = {}) => {
  const children = [
    new Paragraph({
      children: [new TextRun({ text: article.seoTitle || article.title || "Article", bold: true, size: 40, color: NAVY })],
      spacing: { after: 160 },
    }),
    metaLine("Slug", article.slug),
    metaLine("Category", article.category),
    metaLine("Keywords", article.keywords),
    metaLine("Meta description", article.metaDesc),
    metaLine("Word count", article.wordCount ? `${article.wordCount} words` : ""),
    ...(meta.scheduled ? [metaLine("Scheduled", meta.scheduled)] : []),
    ...(meta.client ? [metaLine("Client", meta.client)] : []),
    new Paragraph({
      text: "",
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "BEE3F8" } },
      spacing: { after: 240 },
    }),
    ...blocks.flatMap(b => blockToElements(b, images)),
  ];

  return new Document({
    creator: "Blog Engine",
    title: article.seoTitle || article.title || "Article",
    description: article.metaDesc || "",
    numbering: {
      config: [{
        reference: "article-ordered",
        levels: [0, 1, 2].map(level => ({
          level,
          format: level === 1 ? "lowerLetter" : level === 2 ? "lowerRoman" : "decimal",
          text: `%${level + 1}.`,
          alignment: AlignmentType.START,
          style: { paragraph: { indent: { left: 720 * (level + 1), hanging: 360 } } },
        })),
      }],
    },
    styles: {
      default: {
        document:  { run: { font: "Calibri", size: 22, color: "1A202C" }, paragraph: { spacing: { line: 300 } } },
        heading1:  { run: { font: "Calibri", size: 36, bold: true, color: NAVY } },
        heading2:  { run: { font: "Calibri", size: 30, bold: true, color: BLUE } },
        heading3:  { run: { font: "Calibri", size: 26, bold: true, color: MID } },
        heading4:  { run: { font: "Calibri", size: 24, bold: true, color: MID } },
      },
    },
    sections: [{
      properties: { page: { margin: { top: 1134, right: 1134, bottom: 1134, left: 1134 } } },
      children,
    }],
  });
};

export const docToBlob = (doc) => Packer.toBlob(doc);
export const docToBuffer = (doc) => Packer.toBuffer(doc);
