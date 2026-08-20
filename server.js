const express = require("express");
const cors    = require("cors");
const path    = require("path");
const crypto  = require("crypto");
const { Pool } = require("pg");

const PORT   = parseInt(process.env.PORT || "3000", 10);

const app = express();
app.set("trust proxy", 1); // behind Coolify/Traefik — needed for correct req.ip

// ── PostgreSQL ───────────────────────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false,
});

const initDB = async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      key        TEXT PRIMARY KEY,
      value      JSONB NOT NULL,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS articles (
      id           TEXT PRIMARY KEY,
      month_key    TEXT NOT NULL,
      title        TEXT,
      seo_title    TEXT,
      slug         TEXT,
      category     TEXT,
      keywords     TEXT,
      meta_desc    TEXT,
      content      TEXT,
      word_count   INTEGER DEFAULT 0,
      status       TEXT DEFAULT 'pending',
      scheduled_at TIMESTAMPTZ,
      images       JSONB,
      error        TEXT,
      created_at   TIMESTAMPTZ DEFAULT NOW(),
      updated_at   TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_articles_month ON articles(month_key);
  `);
  console.log("[DB] PostgreSQL tables ready");
};

const readState = async () => {
  const { rows } = await pool.query("SELECT value FROM app_state WHERE key = 'main'");
  return rows[0]?.value || {};
};

// Every state save used to rewrite every article row — 100+ statements each
// time a Settings field was typed in. Track what was last written and skip
// rows that have not changed. Empty after a restart, so the first save still
// writes everything.
const articleHashes = new Map();
const hashOf = (o) => crypto.createHash("sha1").update(JSON.stringify(o)).digest("hex");

const syncArticles = async (months) => {
  if (!months) return;
  for (const [monthKey, monthData] of Object.entries(months)) {
    for (const a of (monthData.articles || [])) {
      const h = hashOf([monthKey, a]);
      if (articleHashes.get(a.id) === h) continue;
      await pool.query(`
        INSERT INTO articles
          (id, month_key, title, seo_title, slug, category, keywords, meta_desc,
           content, word_count, status, scheduled_at, images, error, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
        ON CONFLICT (id) DO UPDATE SET
          title=$3, seo_title=$4, slug=$5, category=$6, keywords=$7, meta_desc=$8,
          content=$9, word_count=$10, status=$11, scheduled_at=$12, images=$13,
          error=$14, updated_at=NOW()
      `, [
        a.id, monthKey, a.title||null, a.seoTitle||null, a.slug||null,
        a.category||null, a.keywords||null, a.metaDesc||null, a.content||null,
        a.wordCount||0, a.status||"pending",
        a.scheduledAt || null,
        a.images ? JSON.stringify(a.images) : null,
        a.error||null,
      ]);
      articleHashes.set(a.id, h);
    }
  }
  // Drop rows for months the user deleted, so the table does not grow forever
  const keys = Object.keys(months);
  if (keys.length) await pool.query("DELETE FROM articles WHERE month_key <> ALL($1::text[])", [keys]);
};

// ── Secret masking ───────────────────────────────────────────────
const { isMasked, redactState, unmaskState, unsplashKeysOf } = require("./secrets");

// Resolve WordPress credentials for a request. The browser only ever holds a
// masked password, so anything masked is looked up by site id server-side.
// Raw credentials are still accepted for testing a site before it is saved.
const resolveCreds = async (body) => {
  let { siteId, url, user, appPass } = body || {};
  if (siteId && (!appPass || isMasked(appPass) || !url || !user)) {
    const site = (await readState()).sites?.find(s => s.id === siteId);
    if (site) {
      url  = url  || site.url;
      user = user || site.user;
      if (!appPass || isMasked(appPass)) appPass = site.appPass;
    }
  }
  return { url, user, appPass };
};

// ── Middleware ───────────────────────────────────────────────────
// The React build is served from this same origin, so cross-origin access is
// off by default. Set CORS_ORIGIN only if you front the API from elsewhere.
if (process.env.CORS_ORIGIN) {
  app.use(cors({ origin: process.env.CORS_ORIGIN.split(",").map(s => s.trim()) }));
}
app.use(express.json({ limit: "100mb" }));

// ── Auth ─────────────────────────────────────────────────────────
const AUTH_PASS = process.env.APP_PASSWORD;

// Constant-time compare so response timing does not leak the password
const passMatches = (given) => {
  if (typeof given !== "string") return false;
  const a = Buffer.from(given);
  const b = Buffer.from(AUTH_PASS);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
};

// Throttle login attempts per IP: 10 tries per 15 minutes
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX = 10;
const loginAttempts = new Map();

const tooManyAttempts = (ip) => {
  const now = Date.now();
  const rec = loginAttempts.get(ip);
  if (!rec || now - rec.first > LOGIN_WINDOW_MS) {
    loginAttempts.set(ip, { count: 1, first: now });
    return false;
  }
  rec.count += 1;
  return rec.count > LOGIN_MAX;
};

// Drop expired throttle records so the map cannot grow without bound
setInterval(() => {
  const cutoff = Date.now() - LOGIN_WINDOW_MS;
  for (const [ip, rec] of loginAttempts) if (rec.first < cutoff) loginAttempts.delete(ip);
}, LOGIN_WINDOW_MS).unref();

// Login endpoint — exempt from the auth check below
app.post("/api/auth", (req, res) => {
  if (!AUTH_PASS) return res.json({ ok: true });
  if (tooManyAttempts(req.ip)) return res.status(429).json({ error: "Too many attempts — try again later" });
  if (passMatches(req.body?.password)) {
    loginAttempts.delete(req.ip);
    return res.json({ ok: true });
  }
  res.status(401).json({ error: "Wrong password" });
});

// Protect all other /api routes (health check is exempt so Coolify/Docker can probe it)
app.use("/api", (req, res, next) => {
  if (!AUTH_PASS) return next();
  if (req.path === "/health") return next();
  if (passMatches(req.headers["x-app-key"])) return next();
  res.status(401).json({ error: "Unauthorized" });
});

// ── API Routes ───────────────────────────────────────────────────
app.get("/api/state", async (req, res) => {
  try {
    res.json(redactState(await readState()));
  } catch (e) {
    console.error("[DB] read error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

// Belt-and-braces against a client that lost its data and saves blanks over
// everything. A user deleting records one at a time never empties all four
// collections in a single write, so this only ever catches the failure case.
const wouldWipeEverything = (incoming, stored) => {
  const size = (s) => Object.keys(s.months || {}).length + (s.clients || []).length
    + (s.sites || []).length + (s.payments || []).length;
  return size(stored) > 0 && size(incoming) === 0;
};

app.post("/api/state", async (req, res) => {
  try {
    const stored = await readState();
    if (wouldWipeEverything(req.body || {}, stored)) {
      console.warn("[DB] refused a save that would have emptied every collection");
      return res.status(409).json({ error: "Refused: this save would erase all stored data. Reload the page and try again." });
    }
    const merged = unmaskState(req.body || {}, stored);
    await pool.query(`
      INSERT INTO app_state (key, value, updated_at) VALUES ('main', $1, NOW())
      ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()
    `, [merged]);
    syncArticles(merged.months).catch(e => console.error("[DB] sync error:", e.message));
    res.json({ ok: true });
  } catch (e) {
    console.error("[DB] write error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/health", async (_req, res) => {
  try {
    const { rows } = await pool.query("SELECT COUNT(*) as n FROM articles");
    res.json({ ok: true, env: process.env.NODE_ENV || "development", articles: parseInt(rows[0].n) });
  } catch (e) {
    res.status(503).json({ ok: false, error: e.message });
  }
});

// ── Grok proxy (keeps the xAI key off the client) ────────────────
app.post("/api/ai/generate", async (req, res) => {
  const { prompt } = req.body || {};
  if (!prompt) return res.status(400).json({ error: "prompt required" });

  let key, model;
  try {
    const cfg = (await readState()).config || {};
    key   = process.env.GROK_API_KEY || cfg.grokKey;
    model = cfg.grokModel || "grok-3-mini";
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
  if (!key) return res.status(400).json({ error: "Grok API key not set — add it in Settings" });

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ model, messages: [{ role: "user", content: prompt }] }),
        signal: AbortSignal.timeout(180000),
      });
      const data = await r.json();
      if (!r.ok) {
        const msg = data.error?.message || data.message || `HTTP ${r.status}`;
        if (r.status === 429 && attempt < 2) {
          await new Promise(s => setTimeout(s, 15000));
          continue;
        }
        return res.status(r.status).json({ error: msg });
      }
      return res.json({ text: data.choices?.[0]?.message?.content || "" });
    } catch (e) {
      if (attempt === 2) {
        const msg = e.name === "TimeoutError" ? "Grok did not respond within 3 minutes" : e.message;
        return res.status(e.name === "TimeoutError" ? 504 : 500).json({ error: msg });
      }
    }
  }
});

// ── Unsplash proxy (keeps access keys off the client) ────────────
// Tracks per-key rate limits in memory and rotates to the next available key.
const unsplashLimits = {}; // keyIndex → epoch ms when the key frees up

app.post("/api/images/search", async (req, res) => {
  const { query } = req.body || {};
  if (!query) return res.status(400).json({ error: "query required" });

  let keys;
  try {
    keys = unsplashKeysOf((await readState()).config || {});
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
  if (!keys.length) return res.json({ results: [], warning: "No Unsplash keys configured" });

  let warning = null;

  for (let tried = 0; tried < keys.length + 1; tried++) {
    const now = Date.now();
    let idx = keys.findIndex((_, i) => !unsplashLimits[i] || now >= unsplashLimits[i]);

    if (idx === -1) {
      // Every key is rate limited — wait for the earliest reset, then reset all
      const earliest = Math.min(...keys.map((_, i) => unsplashLimits[i] || 0));
      const waitMs = Math.max(0, earliest - now + 1500);
      warning = `All ${keys.length} Unsplash key(s) rate limited — waited until ${new Date(earliest).toLocaleTimeString()}`;
      await new Promise(s => setTimeout(s, Math.min(waitMs, 60000)));
      for (const k of Object.keys(unsplashLimits)) delete unsplashLimits[k];
      idx = 0;
    }

    try {
      const r = await fetch(
        `https://api.unsplash.com/search/photos?query=${encodeURIComponent(query)}&per_page=15&orientation=landscape`,
        { headers: { Authorization: `Client-ID ${keys[idx]}` }, signal: AbortSignal.timeout(20000) }
      );
      const remaining = parseInt(r.headers.get("X-Ratelimit-Remaining") ?? "99");

      if (r.status === 429 || remaining === 0) {
        const resetAt = new Date();
        resetAt.setHours(resetAt.getHours() + 1, 0, 10, 0);
        unsplashLimits[idx] = resetAt.getTime();
        warning = `Unsplash key ${idx + 1}/${keys.length} rate limited — switching key`;
        continue;
      }

      if (!r.ok) return res.status(r.status).json({ error: `Unsplash HTTP ${r.status}` });

      const data = await r.json();
      if (remaining <= 8) warning = `Unsplash key ${idx + 1}: ${remaining} requests left this hour`;

      return res.json({
        warning,
        results: (data.results || []).map(p => ({
          id: p.id,
          url: p.urls.regular,
          width: p.width,
          alt: p.alt_description || query,
          credit: `Photo by ${p.user?.name || "Unsplash"} on Unsplash`,
        })),
      });
    } catch (e) {
      if (tried >= keys.length - 1) return res.status(500).json({ error: e.message });
    }
  }

  res.json({ results: [], warning: warning || "No Unsplash key available" });
});

// ── WordPress Proxy (avoids browser CORS) ───────────────────────
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

// Raw image bytes for the .docx export. Goes through the server so the export
// does not depend on the photo host sending CORS headers to the browser.
app.post("/api/images/fetch", async (req, res) => {
  const { imageUrl } = req.body || {};
  if (!imageUrl) return res.status(400).json({ error: "imageUrl required" });
  if (!isFetchableImageUrl(imageUrl)) return res.status(400).json({ error: "imageUrl must be a public http(s) URL" });
  try {
    const r = await fetch(imageUrl, { signal: AbortSignal.timeout(20000), redirect: "follow" });
    if (!r.ok) return res.status(502).json({ error: `Could not fetch image: ${r.status}` });
    const type = r.headers.get("content-type") || "image/jpeg";
    if (!/^image\//i.test(type)) return res.status(400).json({ error: `Not an image (${type})` });
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > MAX_IMAGE_BYTES) return res.status(413).json({ error: "Image larger than 20 MB" });
    res.set("Content-Type", type).send(buf);
  } catch (e) {
    const msg = e.name === "TimeoutError" ? "Image download timed out" : e.message;
    res.status(e.name === "TimeoutError" ? 504 : 500).json({ error: msg });
  }
});

// The image URL is fetched by this server, so an arbitrary value would let a
// logged-in user reach anything the container can reach — cloud metadata,
// internal admin panels — and push the response into their WordPress media
// library. Only public http(s) hosts are allowed.
const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|\[?::1\]?|10\.\d+\.\d+\.\d+|127\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|0\.0\.0\.0)$/i;

const isFetchableImageUrl = (raw) => {
  let u;
  try { u = new URL(String(raw)); } catch { return false; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  return !PRIVATE_HOST.test(u.hostname);
};

// Quotes and newlines here would break out of the Content-Disposition header
const safeFilename = (name) => {
  const clean = String(name || "").replace(/[^A-Za-z0-9._-]/g, "-").replace(/^[-.]+/, "").slice(0, 120);
  return clean || "featured-image.jpg";
};

app.post("/api/wp/test", async (req, res) => {
  const { url, user, appPass } = await resolveCreds(req.body);
  if (!url || !user || !appPass) return res.status(400).json({ error: "url, user, appPass required" });
  try {
    const base = url.replace(/\/$/, "").replace(/\/wp-admin.*$/, "");
    const auth = "Basic " + Buffer.from(`${user}:${appPass.replace(/\s+/g, "")}`).toString("base64");
    const r = await fetch(`${base}/wp-json/wp/v2/users/me`, { headers: { Authorization: auth } });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.message || `HTTP ${r.status}` });
    res.json({ ok: true, name: data.name, roles: data.roles });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/wp/post", async (req, res) => {
  const { url, user, appPass } = await resolveCreds(req.body);
  const { post } = req.body;
  if (!url || !user || !appPass) return res.status(400).json({ error: "url, user, appPass required" });
  try {
    const base = url.replace(/\/$/, "");
    const auth = "Basic " + Buffer.from(`${user}:${appPass.replace(/\s+/g, "")}`).toString("base64");
    const r = await fetch(`${base}/wp-json/wp/v2/posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: auth },
      body: JSON.stringify(post),
      signal: AbortSignal.timeout(90000),
    });
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json({ error: data.message || `HTTP ${r.status}` });
    res.json(data);
  } catch (e) {
    const msg = e.name === "TimeoutError" ? "WordPress did not respond within 90s — check site connectivity" : e.message;
    res.status(e.name === "TimeoutError" ? 504 : 500).json({ error: msg });
  }
});

app.post("/api/wp/upload-image", async (req, res) => {
  const { url, user, appPass } = await resolveCreds(req.body);
  const { imageUrl, filename, alt } = req.body;
  if (!url || !user || !appPass || !imageUrl) return res.status(400).json({ error: "url, user, appPass, imageUrl required" });
  if (!isFetchableImageUrl(imageUrl)) return res.status(400).json({ error: "imageUrl must be a public http(s) URL" });
  try {
    const base = url.replace(/\/$/, "");
    const auth = "Basic " + Buffer.from(`${user}:${appPass.replace(/\s+/g, "")}`).toString("base64");
    // Fetch image bytes from Unsplash with a 15s timeout
    const imgRes = await fetch(imageUrl, { signal: AbortSignal.timeout(15000), redirect: "follow" });
    if (!imgRes.ok) return res.status(502).json({ error: `Could not fetch image: ${imgRes.status}` });
    const contentType = imgRes.headers.get("content-type") || "image/jpeg";
    if (!/^image\//i.test(contentType)) return res.status(400).json({ error: `Not an image (${contentType})` });
    const imgBuffer = Buffer.from(await imgRes.arrayBuffer());
    if (imgBuffer.length > MAX_IMAGE_BYTES) return res.status(413).json({ error: "Image larger than 20 MB" });
    const fname = safeFilename(filename);
    // Upload to WP media library with a 30s timeout
    const uploadRes = await fetch(`${base}/wp-json/wp/v2/media`, {
      method: "POST",
      headers: {
        Authorization: auth,
        "Content-Disposition": `attachment; filename="${fname}"`,
        "Content-Type": contentType,
      },
      body: imgBuffer,
      signal: AbortSignal.timeout(30000),
    });
    const mediaData = await uploadRes.json();
    if (!uploadRes.ok) return res.status(uploadRes.status).json({ error: mediaData.message || `HTTP ${uploadRes.status}` });
    // Set alt text (best-effort, no timeout needed)
    if (alt) {
      await fetch(`${base}/wp-json/wp/v2/media/${mediaData.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: auth },
        body: JSON.stringify({ alt_text: alt }),
        signal: AbortSignal.timeout(10000),
      }).catch(() => {});
    }
    res.json({ id: mediaData.id, url: mediaData.source_url });
  } catch (e) {
    const msg = e.name === "TimeoutError" ? "Image upload timed out" : e.message;
    res.status(e.name === "TimeoutError" ? 504 : 500).json({ error: msg });
  }
});

// Check if a post with the given slug already exists (prevents duplicates on retry)
app.post("/api/wp/find-post", async (req, res) => {
  const { url, user, appPass } = await resolveCreds(req.body);
  const { slug } = req.body;
  if (!url || !user || !appPass || !slug) return res.json({ found: false });
  try {
    const base = url.replace(/\/$/, "");
    const auth = "Basic " + Buffer.from(`${user}:${appPass.replace(/\s+/g, "")}`).toString("base64");
    const r = await fetch(
      `${base}/wp-json/wp/v2/posts?slug=${encodeURIComponent(slug)}&status=any&per_page=1`,
      { headers: { Authorization: auth }, signal: AbortSignal.timeout(10000) }
    );
    const data = await r.json();
    if (Array.isArray(data) && data.length > 0) {
      return res.json({ found: true, id: data[0].id, status: data[0].status });
    }
    res.json({ found: false });
  } catch {
    res.json({ found: false });
  }
});

app.post("/api/wp/category", async (req, res) => {
  const { url, user, appPass } = await resolveCreds(req.body);
  const { name } = req.body;
  if (!url || !user || !appPass) return res.status(400).json({ error: "url, user, appPass required" });
  if (!name || !String(name).trim()) return res.status(400).json({ error: "name required" });
  try {
    const base = url.replace(/\/$/, "");
    const auth = "Basic " + Buffer.from(`${user}:${appPass.replace(/\s+/g, "")}`).toString("base64");
    // Search first
    const search = await fetch(`${base}/wp-json/wp/v2/categories?search=${encodeURIComponent(name)}&per_page=10`, { headers: { Authorization: auth } });
    const list = await search.json();
    const match = Array.isArray(list) && list.find(c => c.name.toLowerCase() === name.toLowerCase());
    if (match) return res.json({ id: match.id });
    // Create
    const create = await fetch(`${base}/wp-json/wp/v2/categories`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: auth },
      body: JSON.stringify({ name }),
    });
    const cat = await create.json();
    res.json({ id: cat.id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Serve React build if dist exists ────────────────────────────
const fs   = require("fs");
const DIST = path.join(__dirname, "dist");
if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get("/{*path}", (_req, res) => res.sendFile(path.join(DIST, "index.html")));
  console.log("[Blog Engine] Serving React build from /dist");
}

// ── Start ────────────────────────────────────────────────────────
const start = async () => {
  await initDB();
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Blog Engine] → http://0.0.0.0:${PORT}  (NODE_ENV=${process.env.NODE_ENV || "unset"})`);
  });
};

start().catch(e => { console.error("[FATAL]", e.message); process.exit(1); });
