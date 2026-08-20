// Exercises the Express image byte proxy the .docx export relies on, against
// a stubbed Postgres so no database is needed.
import assert from "assert";
import Module from "module";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 3996;
process.env.PORT = String(PORT);
process.env.APP_PASSWORD = "testpass";
process.env.DATABASE_URL = "postgres://stub";

const db = { config: { unsplashKeys: [] }, months: {}, clients: [], sites: [], payments: [] };
class FakePool {
  async query(sql, params) {
    if (/CREATE TABLE/i.test(sql)) return {};
    if (/SELECT value FROM app_state/i.test(sql)) return { rows: [{ value: db }] };
    if (/INSERT INTO app_state/i.test(sql)) return {};
    if (/SELECT COUNT/i.test(sql)) return { rows: [{ n: "0" }] };
    if (/INSERT INTO articles|DELETE FROM articles/i.test(sql)) return {};
    throw new Error("unexpected SQL: " + sql.slice(0, 60));
  }
}
const origLoad = Module._load;
Module._load = function (request) {
  if (request === "pg") return { Pool: FakePool };
  return origLoad.apply(this, arguments);
};
Module.createRequire(import.meta.url)(path.join(ROOT, "server.js"));

const B = `http://127.0.0.1:${PORT}`;
const req = async (url, { body, key } = {}) => {
  const headers = { "Content-Type": "application/json" };
  if (key) headers["x-app-key"] = key;
  const r = await fetch(B + url, { method: "POST", headers, body: JSON.stringify(body || {}) });
  return { status: r.status, type: r.headers.get("content-type") || "" };
};

let pass = 0, fail = 0;
const t = async (name, fn) => {
  try { await fn(); pass++; console.log("  ok  -", name); }
  catch (e) { fail++; console.log("  FAIL-", name, "\n        ", e.message); }
};

await new Promise(r => setTimeout(r, 700));

console.log("\nImage byte proxy");
await t("requires authentication like every other route", async () => {
  const r = await req("/api/images/fetch", { body: { imageUrl: "https://images.unsplash.com/p" } });
  assert.strictEqual(r.status, 401);
});
await t("rejects a missing url", async () => {
  assert.strictEqual((await req("/api/images/fetch", { body: {}, key: "testpass" })).status, 400);
});

const blocked = [
  "http://169.254.169.254/latest/meta-data/",
  "http://localhost:8080/admin",
  "http://127.0.0.1/",
  "http://10.1.2.3/x",
  "http://192.168.0.9/x",
  "http://172.20.0.1/x",
  "file:///etc/passwd",
  "javascript:alert(1)",
  "not a url",
];
for (const bad of blocked) {
  await t(`refuses to fetch ${bad}`, async () => {
    const r = await req("/api/images/fetch", { body: { imageUrl: bad }, key: "testpass" });
    assert.strictEqual(r.status, 400, `allowed ${bad}`);
  });
}
await t("a public https photo URL gets past the guard", async () => {
  const r = await req("/api/images/fetch", { body: { imageUrl: "https://images.unsplash.com/photo-1" }, key: "testpass" });
  assert.notStrictEqual(r.status, 400, "public URL was rejected by the guard");
});

console.log(`\n${pass} passed, ${fail} failed`);
setTimeout(() => process.exit(fail ? 1 : 0), 50);
