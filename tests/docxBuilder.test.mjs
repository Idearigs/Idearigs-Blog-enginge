// Builds a real .docx and inspects the package, so "the images are in there"
// is proven from the file itself rather than assumed.
import assert from "assert";
import JSZip from "jszip";
import { htmlToBlocks, imageSources } from "../src/htmlBlocks.js";
import { buildArticleDoc, docToBuffer, fitImage, imageType, MAX_IMAGE_WIDTH } from
  "../src/docxBuilder.js";

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass++; console.log("  ok  -", name); }
  catch (e) { fail++; console.log("  FAIL-", name, "\n        ", e.message); }
};

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64");
const GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7", "base64");
const JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  "base64");

const ARTICLE_HTML = `
<p>Sri Lanka rewards travellers who plan around the monsoon.</p>
<h2>Key Takeaways</h2>
<ul><li><strong>Two monsoons</strong> split the island.</li><li>Book <em>early</em> for December.</li></ul>
<figure><img src="https://images.unsplash.com/photo-a" alt="Tea fields at sunrise"/>
<figcaption>Photo by Ann Example on Unsplash</figcaption></figure>
<h2>What it costs</h2>
<table><tr><th>Season</th><th>Nightly</th></tr><tr><td>Peak</td><td>$120</td></tr><tr><td>Shoulder</td><td>$70</td></tr></table>
<p>Book with <a href="https://alphatravel.com">Alpha Travel</a> today.</p>
<h2>Frequently Asked Questions</h2>
<h3>Is it safe?</h3><p>Yes, very.</p>
<script type="application/ld+json">{"@type":"FAQPage"}</script>`;

const article = {
  seoTitle: "Best Time to Visit Sri Lanka in 2026",
  slug: "best-time-sri-lanka-2026",
  category: "Travel Tips",
  keywords: "sri lanka weather, monsoon",
  metaDesc: "A season-by-season guide.",
  wordCount: 2145,
};

const blocks = htmlToBlocks(ARTICLE_HTML);
const images = new Map([
  ["https://images.unsplash.com/photo-a", { data: PNG, width: 1600, height: 1067, mime: "image/png" }],
]);

const build = async (opts) => {
  const buf = await docToBuffer(buildArticleDoc(opts));
  const zip = await JSZip.loadAsync(buf);
  const doc = await zip.file("word/document.xml").async("string");
  const names = Object.keys(zip.files);
  // JSZip lists directory entries as well — only real parts count
  const media = names.filter(n => n.startsWith("word/media/") && !zip.files[n].dir);
  return { buf, zip, doc, names, media };
};

console.log("\nImage sizing");
await t("scales a wide photo down to the text column", () => {
  assert.deepStrictEqual(fitImage(1600, 1067), { width: 600, height: 400 });
});
await t("leaves a small image alone", () => {
  assert.deepStrictEqual(fitImage(320, 240), { width: 320, height: 240 });
});
await t("preserves aspect ratio for a portrait image", () => {
  const r = fitImage(1000, 2000);
  assert.strictEqual(r.width, MAX_IMAGE_WIDTH);
  assert.strictEqual(r.height, 1200);
});
await t("missing dimensions still produce a usable size", () => {
  const r = fitImage(undefined, undefined);
  assert.ok(r.width > 0 && r.height > 0);
});
await t("maps mime types to the format docx expects", () => {
  assert.strictEqual(imageType("image/png"), "png");
  assert.strictEqual(imageType("image/jpeg"), "jpg");
  assert.strictEqual(imageType("", "photo.GIF"), "gif");
  assert.strictEqual(imageType("application/octet-stream", "x"), "jpg");
});

console.log("\nThe package is a valid docx");
const { zip, doc, names, media } = await build({ article, blocks, images, meta: { client: "Alpha Travel", scheduled: "1 Aug 2026" } });

await t("contains the parts Word requires", () => {
  for (const need of ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/_rels/document.xml.rels"]) {
    assert.ok(names.includes(need), `missing ${need}`);
  }
});
await t("REGRESSION: the image bytes are inside the file", async () => {
  assert.strictEqual(media.length, 1, `expected 1 embedded image, found ${media.length}`);
  const bytes = await zip.file(media[0]).async("uint8array");
  assert.ok(bytes.length > 0, "embedded image is empty");
  assert.deepStrictEqual(Buffer.from(bytes), PNG, "embedded bytes differ from the source image");
});
await t("REGRESSION: no data: URI is used anywhere", () => {
  assert.ok(!doc.includes("data:image"), "still embedding images the way Word ignores");
});
await t("the document references the image part", async () => {
  assert.ok(/<a:blip[^>]*r:embed="rId\d+"/.test(doc), "no drawing reference in document.xml");
  const rels = await zip.file("word/_rels/document.xml.rels").async("string");
  assert.ok(/Type="[^"]*\/image"[^>]*Target="media\/[^"]+\.png"/.test(rels), "image not related to the document");
});
await t("the image is declared in [Content_Types]", async () => {
  const ct = await zip.file("[Content_Types].xml").async("string");
  assert.ok(/Extension="png"/i.test(ct), "png extension not declared — Word would reject the file");
});
await t("alt text travels with the image", () => {
  assert.ok(doc.includes("Tea fields at sunrise"));
});
await t("the caption is kept under the photo", () => {
  assert.ok(doc.includes("Photo by Ann Example on Unsplash"));
});

console.log("\nContent fidelity");
await t("the title and metadata are present", () => {
  assert.ok(doc.includes("Best Time to Visit Sri Lanka in 2026"));
  assert.ok(doc.includes("best-time-sri-lanka-2026"));
  assert.ok(doc.includes("2145 words"));
  assert.ok(doc.includes("Alpha Travel"));
});
await t("headings use real Word heading styles", () => {
  assert.ok(doc.includes("Heading1") || doc.includes("Heading2"), "headings are not styled as headings");
  assert.ok(doc.includes("Key Takeaways"));
  assert.ok(doc.includes("Frequently Asked Questions"));
});
await t("bold and italic survive", () => {
  assert.ok(doc.includes("Two monsoons"));
  assert.ok(/<w:b\b/.test(doc), "no bold runs");
  assert.ok(/<w:i\b/.test(doc), "no italic runs");
});
await t("the list becomes a Word list", () => {
  assert.ok(/<w:numPr>/.test(doc), "list items are plain paragraphs");
});
await t("the comparison table is a real table", () => {
  assert.ok(/<w:tbl>/.test(doc), "table lost");
  assert.ok(doc.includes("Shoulder") && doc.includes("$70"));
});
await t("the link is a working hyperlink", () => {
  assert.ok(/<w:hyperlink/.test(doc), "link flattened to plain text");
});
await t("the JSON-LD script does not appear in the document", () => {
  assert.ok(!doc.includes("FAQPage"));
});

console.log("\nDegraded inputs");
await t("a failed image download leaves a visible note, not a silent gap", async () => {
  const r = await build({ article, blocks, images: new Map() });
  assert.ok(r.doc.includes("image unavailable"), "the missing image vanished without trace");
  assert.strictEqual(r.media.length, 0);
});
await t("an article with no content still produces a readable file", async () => {
  const r = await build({ article, blocks: [], images: new Map() });
  assert.ok(r.doc.includes("Best Time to Visit Sri Lanka in 2026"));
  assert.ok(r.names.includes("word/document.xml"));
});
await t("no arguments at all does not throw", async () => {
  const buf = await docToBuffer(buildArticleDoc());
  assert.ok(buf.length > 0);
});
await t("several distinct images each get their own part", async () => {
  const b = htmlToBlocks('<img src="a"><p>x</p><img src="b"><p>y</p><img src="c">');
  const imgs = new Map([
    ["a", { data: PNG,  width: 800, height: 600, mime: "image/png" }],
    ["b", { data: GIF,  width: 800, height: 600, mime: "image/gif" }],
    ["c", { data: JPEG, width: 800, height: 600, mime: "image/jpeg" }],
  ]);
  const r = await build({ article, blocks: b, images: imgs });
  assert.strictEqual(r.media.length, 3, "an image was dropped");
  const ct = await r.zip.file("[Content_Types].xml").async("string");
  for (const ext of ["png", "gif", "jpg"]) {
    assert.ok(new RegExp(`Extension="${ext}"`, "i").test(ct), `${ext} not declared in [Content_Types]`);
  }
});
await t("identical images are stored once but still render at every placement", async () => {
  const b = htmlToBlocks('<img src="a"><img src="b">');
  const same = { data: PNG, width: 800, height: 600, mime: "image/png" };
  const r = await build({ article, blocks: b, images: new Map([["a", same], ["b", same]]) });
  assert.strictEqual(r.media.length, 1);
  assert.strictEqual((r.doc.match(/<a:blip/g) || []).length, 2);
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
