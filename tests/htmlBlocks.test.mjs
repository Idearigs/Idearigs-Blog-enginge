import assert from "assert";
import { htmlToBlocks, imageSources, decodeEntities } from
  "../src/htmlBlocks.js";

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); pass++; console.log("  ok  -", name); }
  catch (e) { fail++; console.log("  FAIL-", name, "\n        ", e.message); }
};
// Tables hold cells, not runs — flatten either shape
const textOf = (b) =>
  b.type === "table"
    ? b.rows.flat().map(c => c.runs.map(r => r.text).join("")).join(" ")
    : b.type === "image"
      ? [b.alt, b.caption].filter(Boolean).join(" ")
      : b.runs.map(r => r.text).join("");

console.log("\nEntities");
t("decodes the entities the generator emits", () => {
  assert.strictEqual(decodeEntities("Tea &amp; Spice"), "Tea & Spice");
  assert.strictEqual(decodeEntities("&lt;b&gt;"), "<b>");
  assert.strictEqual(decodeEntities("caf&#233;"), "café");
  assert.strictEqual(decodeEntities("&#x2014;"), "\u2014");
  assert.strictEqual(decodeEntities("a&nbsp;b"), "a\u00A0b");
});
t("does not double-decode", () => {
  assert.strictEqual(decodeEntities("&amp;lt;"), "&lt;");
});

console.log("\nHeadings and paragraphs");
t("extracts headings with their level", () => {
  const b = htmlToBlocks("<h2>Beaches</h2><h3>Mirissa</h3>");
  assert.deepStrictEqual(b.map(x => [x.type, x.level, textOf(x)]),
    [["heading", 2, "Beaches"], ["heading", 3, "Mirissa"]]);
});
t("extracts paragraphs", () => {
  const b = htmlToBlocks("<p>One.</p><p>Two.</p>");
  assert.strictEqual(b.length, 2);
  assert.strictEqual(textOf(b[1]), "Two.");
});
t("drops empty and whitespace-only blocks", () => {
  assert.strictEqual(htmlToBlocks("<p></p><p>   </p><p>real</p>").length, 1);
});
t("trims leading and trailing whitespace inside a block", () => {
  assert.strictEqual(textOf(htmlToBlocks("<p>   spaced   </p>")[0]), "spaced");
});
t("collapses newlines and runs of spaces", () => {
  assert.strictEqual(textOf(htmlToBlocks("<p>a\n\n   b</p>")[0]), "a b");
});
t("text outside any tag is still captured", () => {
  assert.strictEqual(textOf(htmlToBlocks("loose text")[0]), "loose text");
});

console.log("\nInline formatting");
t("marks bold runs", () => {
  const runs = htmlToBlocks("<p>a <strong>bold</strong> c</p>")[0].runs;
  assert.deepStrictEqual(runs.map(r => [r.text, r.bold]), [["a ", false], ["bold", true], [" c", false]]);
});
t("marks italic runs", () => {
  const runs = htmlToBlocks("<p><em>it</em></p>")[0].runs;
  assert.strictEqual(runs[0].italic, true);
});
t("handles nested bold and italic", () => {
  const runs = htmlToBlocks("<p><strong>b<em>bi</em></strong></p>")[0].runs;
  const bi = runs.find(r => r.text === "bi");
  assert.ok(bi.bold && bi.italic);
});
t("b and i are treated like strong and em", () => {
  const runs = htmlToBlocks("<p><b>x</b><i>y</i></p>")[0].runs;
  assert.strictEqual(runs[0].bold, true);
  assert.strictEqual(runs[1].italic, true);
});
t("captures link hrefs", () => {
  const runs = htmlToBlocks('<p>see <a href="https://x.com/a">here</a></p>')[0].runs;
  assert.strictEqual(runs.find(r => r.text === "here").link, "https://x.com/a");
});
t("adjacent runs with the same formatting merge", () => {
  assert.strictEqual(htmlToBlocks("<p>a<span>b</span>c</p>")[0].runs.length, 1);
});
t("unbalanced closing tags do not corrupt later text", () => {
  const b = htmlToBlocks("<p></strong>plain</p><p>after</p>");
  assert.strictEqual(b[1].runs[0].bold, false);
});

console.log("\nLists");
t("unordered list items", () => {
  const b = htmlToBlocks("<ul><li>one</li><li>two</li></ul>");
  assert.strictEqual(b.length, 2);
  assert.ok(b.every(x => x.type === "listItem" && !x.ordered && x.level === 0));
  assert.strictEqual(textOf(b[1]), "two");
});
t("ordered list items are marked", () => {
  const b = htmlToBlocks("<ol><li>first</li></ol>");
  assert.strictEqual(b[0].ordered, true);
});
t("nested lists carry a level", () => {
  const b = htmlToBlocks("<ul><li>a</li><ul><li>b</li></ul></ul>");
  assert.deepStrictEqual(b.map(x => x.level), [0, 1]);
});
t("formatting inside a list item survives", () => {
  const b = htmlToBlocks("<ul><li><strong>key</strong>: value</li></ul>");
  assert.strictEqual(b[0].runs[0].bold, true);
  assert.strictEqual(textOf(b[0]), "key: value");
});

console.log("\nImages");
const figure = '<figure><img src="https://img/1.jpg" alt="Beach at dawn"/>' +
               '<figcaption>Photo by Ann on Unsplash</figcaption></figure>';
t("REGRESSION: an image becomes its own block", () => {
  const b = htmlToBlocks(figure);
  assert.strictEqual(b.length, 1, "image was dropped or split");
  assert.strictEqual(b[0].type, "image");
  assert.strictEqual(b[0].src, "https://img/1.jpg");
  assert.strictEqual(b[0].alt, "Beach at dawn");
});
t("the caption attaches to its image", () => {
  assert.strictEqual(htmlToBlocks(figure)[0].caption, "Photo by Ann on Unsplash");
});
t("images between paragraphs keep document order", () => {
  const b = htmlToBlocks(`<p>before</p>${figure}<p>after</p>`);
  assert.deepStrictEqual(b.map(x => x.type), ["paragraph", "image", "paragraph"]);
});
t("a bare img with no figure still works", () => {
  const b = htmlToBlocks('<p>x</p><img src="u.png">');
  assert.strictEqual(b[1].type, "image");
});
t("an img with no src is ignored", () => {
  assert.strictEqual(htmlToBlocks('<img alt="nothing">').length, 0);
});
t("single-quoted and unquoted attributes parse", () => {
  assert.strictEqual(htmlToBlocks("<img src='a.jpg'>")[0].src, "a.jpg");
  assert.strictEqual(htmlToBlocks("<img src=b.jpg>")[0].src, "b.jpg");
});
t("imageSources lists every distinct image in order", () => {
  const b = htmlToBlocks('<img src="a.jpg"><p>x</p><img src="b.jpg"><img src="a.jpg">');
  assert.deepStrictEqual(imageSources(b), ["a.jpg", "b.jpg"]);
});
t("a caption with no preceding image is not lost", () => {
  const b = htmlToBlocks("<figcaption>orphan</figcaption>");
  assert.strictEqual(textOf(b[0]), "orphan");
});

console.log("\nTables");
const table = "<table><tr><th>Season</th><th>Cost</th></tr>" +
              "<tr><td>Peak</td><td>$120</td></tr></table>";
t("builds rows and cells", () => {
  const b = htmlToBlocks(table);
  assert.strictEqual(b[0].type, "table");
  assert.strictEqual(b[0].rows.length, 2);
  assert.strictEqual(b[0].rows[1].length, 2);
  assert.strictEqual(b[0].rows[1][1].runs[0].text, "$120");
});
t("header cells are flagged", () => {
  const b = htmlToBlocks(table);
  assert.strictEqual(b[0].rows[0][0].header, true);
  assert.strictEqual(b[0].rows[1][0].header, false);
});
t("formatting inside a cell survives", () => {
  const b = htmlToBlocks("<table><tr><td><strong>bold</strong></td></tr></table>");
  assert.strictEqual(b[0].rows[0][0].runs[0].bold, true);
});
t("a table between paragraphs keeps its place", () => {
  const b = htmlToBlocks(`<p>a</p>${table}<p>b</p>`);
  assert.deepStrictEqual(b.map(x => x.type), ["paragraph", "table", "paragraph"]);
});
t("an unclosed table is still emitted", () => {
  const b = htmlToBlocks("<table><tr><td>x</td></tr>");
  assert.strictEqual(b[0].type, "table");
});

console.log("\nNoise");
t("script and style content is discarded", () => {
  const b = htmlToBlocks('<p>keep</p><script type="application/ld+json">{"a":1}</script><style>p{color:red}</style>');
  assert.strictEqual(b.length, 1);
  assert.strictEqual(textOf(b[0]), "keep");
});
t("the FAQ JSON-LD block does not leak into the document", () => {
  const html = '<h2>FAQ</h2><h3>Q?</h3><p>A.</p>\n<script type="application/ld+json">{"@type":"FAQPage"}</script>';
  assert.ok(!htmlToBlocks(html).some(x => textOf(x).includes("FAQPage")));
});
t("empty and junk input is safe", () => {
  assert.deepStrictEqual(htmlToBlocks(""), []);
  assert.deepStrictEqual(htmlToBlocks(null), []);
  // Browsers render stray angle brackets as text too, so a leftover ">" is
  // acceptable — what matters is that it neither throws nor invents structure.
  assert.ok(htmlToBlocks("<<>>").every(b => b.type === "paragraph"));
});

console.log("\nA whole generated article");
const article = `<p>Intro para.</p><h2>Key Takeaways</h2><ul><li><strong>One</strong></li><li>Two</li></ul>
${figure}<h2>Costs</h2>${table}<p>Book with <a href="https://x.lk">Alpha</a> today.</p>
<h2>Frequently Asked Questions</h2><h3>Is it safe?</h3><p>Yes.</p>
<script type="application/ld+json">{"@type":"FAQPage"}</script>`;
t("every part of a real article survives", () => {
  const b = htmlToBlocks(article);
  const types = b.map(x => x.type);
  assert.ok(types.includes("image"), "image lost");
  assert.ok(types.includes("table"), "table lost");
  assert.ok(types.includes("listItem"), "list lost");
  assert.strictEqual(types.filter(x => x === "heading").length, 4);
  assert.ok(!b.some(x => textOf(x).includes("FAQPage")));
});
t("the image is positioned between its neighbours", () => {
  const b = htmlToBlocks(article);
  const i = b.findIndex(x => x.type === "image");
  assert.ok(i > 0 && b[i - 1].type === "listItem");
  assert.strictEqual(b[i + 1].type, "heading");
});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
