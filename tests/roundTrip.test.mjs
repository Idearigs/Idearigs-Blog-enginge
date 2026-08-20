// download -> edit -> upload, end to end.
// Generates a .docx the way the export does, then reads it back the way the
// upload does, so "the images survive the round trip" is demonstrated rather
// than assumed.
import assert from "assert";
import { createRequire } from "module";
import { htmlToBlocks, imageSources } from "../src/htmlBlocks.js";
import { buildArticleDoc, docToBuffer } from "../src/docxBuilder.js";

const require = createRequire(import.meta.url);
const mammoth = require("mammoth");

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass++; console.log("  ok  -", name); }
  catch (e) { fail++; console.log("  FAIL-", name, "\n        ", e.message); }
};

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64");
const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");

const URL_A = "https://images.unsplash.com/photo-alpha";
const URL_B = "https://images.unsplash.com/photo-beta";

const ARTICLE_HTML = `
<p>Plan around the monsoon.</p>
<h2>Key Takeaways</h2>
<ul><li><strong>Two monsoons</strong> split the island.</li></ul>
<figure><img src="${URL_A}" alt="Tea fields"/><figcaption>Photo by Ann on Unsplash</figcaption></figure>
<h2>Costs</h2>
<table><tr><th>Season</th><th>Nightly</th></tr><tr><td>Peak</td><td>$120</td></tr></table>
<figure><img src="${URL_B}" alt="Coast road"/><figcaption>Photo by Bo on Unsplash</figcaption></figure>
<p>Book with <a href="https://alphatravel.com">Alpha Travel</a>.</p>`;

const article = {
  seoTitle: "Best Time to Visit Sri Lanka",
  slug: "best-time",
  images: [
    { url: URL_A, alt: "Tea fields", credit: "Photo by Ann on Unsplash" },
    { url: URL_B, alt: "Coast road", credit: "Photo by Bo on Unsplash" },
  ],
};

// Exactly the export path
const blocks = htmlToBlocks(ARTICLE_HTML);
const images = new Map([
  [URL_A, { data: PNG, width: 1600, height: 1067, mime: "image/png" }],
  [URL_B, { data: GIF, width: 1200, height: 800, mime: "image/gif" }],
]);
const docxBuffer = await docToBuffer(buildArticleDoc({ article, blocks, images }));

// Exactly the upload path, including the mapping back onto the original URLs
const readBack = async (buffer, known) => {
  let i = 0;
  const r = await mammoth.convertToHtml({ buffer }, {
    convertImage: mammoth.images.imgElement(async (image) => {
      const original = known[i++];
      if (original?.url) return { src: original.url, alt: original.alt || "" };
      const b64 = await image.read("base64");
      return { src: `data:${image.contentType};base64,${b64}` };
    }),
  });
  return r.value;
};

console.log("\nThe generated file is readable by the importer");
await t("mammoth can open the exported .docx", async () => {
  const html = await readBack(docxBuffer, article.images);
  assert.ok(html.length > 0);
});
await t("REGRESSION: the old .doc export was HTML that mammoth could not open", async () => {
  const fakeOldExport = Buffer.from("﻿<html><body><h1>Article</h1></body></html>", "utf8");
  await assert.rejects(() => readBack(fakeOldExport, []), "an HTML file should not import as .docx");
});

console.log("\nContent survives the round trip");
const html = await readBack(docxBuffer, article.images);
await t("headings come back as headings", () => {
  assert.ok(/<h[12][^>]*>/.test(html), "no headings in the imported html");
  assert.ok(html.includes("Key Takeaways"));
  assert.ok(html.includes("Costs"));
});
await t("body text survives", () => {
  assert.ok(html.includes("Plan around the monsoon"));
});
await t("bold survives", () => {
  assert.ok(/<strong>Two monsoons<\/strong>/.test(html), "bold lost");
});
await t("the list survives", () => {
  assert.ok(/<li>/.test(html), "list lost");
});
await t("the table survives", () => {
  assert.ok(/<table>/.test(html), "table lost");
  assert.ok(html.includes("$120"));
});
await t("the hyperlink survives", () => {
  assert.ok(html.includes("alphatravel.com"));
});

console.log("\nImages survive the round trip");
await t("REGRESSION: both images come back", () => {
  const count = (html.match(/<img/g) || []).length;
  assert.strictEqual(count, 2, `expected 2 images, got ${count}`);
});
await t("REGRESSION: they map back to the original URLs, not base64", () => {
  assert.ok(html.includes(URL_A), "first image url lost");
  assert.ok(html.includes(URL_B), "second image url lost");
  assert.ok(!html.includes("data:image"), "images came back as data URIs, which bloat state and WordPress rejects");
});
await t("image order is preserved", () => {
  assert.ok(html.indexOf(URL_A) < html.indexOf(URL_B), "images came back in the wrong order");
});
await t("alt text is carried across", () => {
  assert.ok(html.includes("Tea fields"));
});
await t("an unknown extra image falls back to inline data rather than vanishing", async () => {
  const only = await readBack(docxBuffer, [article.images[0]]);
  assert.ok(only.includes(URL_A));
  assert.ok(only.includes("data:image"), "the unmapped image disappeared");
  assert.strictEqual((only.match(/<img/g) || []).length, 2);
});
await t("no known images at all still keeps every picture", async () => {
  const none = await readBack(docxBuffer, []);
  assert.strictEqual((none.match(/<img/g) || []).length, 2);
});

console.log("\nSanity on the export side");
await t("every image in the article was offered for download", () => {
  assert.deepStrictEqual(imageSources(blocks), [URL_A, URL_B]);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
