const express = require("express");
const cors = require("cors");
const path = require("path");
const Database = require("better-sqlite3");

const isProd = process.env.NODE_ENV === "production";
const PORT = parseInt(process.env.PORT || (isProd ? "3000" : "3001"), 10);
const DB_PATH = process.env.DB_PATH || path.join(__dirname, isProd ? "/data/blog_automation.db" : "blog_automation.db");

const app = express();

// ── Init SQLite ──────────────────────────────────────────────────
const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS state (
    key        TEXT PRIMARY KEY,
    value      TEXT NOT NULL,
    updated_at TEXT DEFAULT (datetime('now'))
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
    scheduled_at TEXT,
    images       TEXT,
    error        TEXT,
    created_at   TEXT DEFAULT (datetime('now')),
    updated_at   TEXT DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_articles_month ON articles(month_key);
`);

const getState  = db.prepare("SELECT value FROM state WHERE key = ?");
const setState  = db.prepare(`
  INSERT INTO state (key, value, updated_at) VALUES (?, ?, datetime('now'))
  ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')
`);
const upsertArticle = db.prepare(`
  INSERT INTO articles
    (id, month_key, title, seo_title, slug, category, keywords, meta_desc,
     content, word_count, status, scheduled_at, images, error, updated_at)
  VALUES
    (@id, @month_key, @title, @seo_title, @slug, @category, @keywords, @meta_desc,
     @content, @word_count, @status, @scheduled_at, @images, @error, datetime('now'))
  ON CONFLICT(id) DO UPDATE SET
    title=excluded.title, seo_title=excluded.seo_title, slug=excluded.slug,
    category=excluded.category, keywords=excluded.keywords, meta_desc=excluded.meta_desc,
    content=excluded.content, word_count=excluded.word_count, status=excluded.status,
    scheduled_at=excluded.scheduled_at, images=excluded.images, error=excluded.error,
    updated_at=datetime('now')
`);

const syncArticles = db.transaction((months) => {
  for (const [monthKey, monthData] of Object.entries(months || {})) {
    for (const a of (monthData.articles || [])) {
      upsertArticle({
        id: a.id, month_key: monthKey,
        title: a.title || null, seo_title: a.seoTitle || null,
        slug: a.slug || null, category: a.category || null,
        keywords: a.keywords || null, meta_desc: a.metaDesc || null,
        content: a.content || null, word_count: a.wordCount || 0,
        status: a.status || "pending", scheduled_at: a.scheduledAt || null,
        images: a.images ? JSON.stringify(a.images) : null,
        error: a.error || null,
      });
    }
  }
});

// ── Middleware ───────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: "100mb" }));

// ── API Routes ───────────────────────────────────────────────────
app.get("/api/state", (req, res) => {
  try {
    const row = getState.get("app_state");
    res.json(row ? JSON.parse(row.value) : {});
  } catch (e) {
    console.error("[DB] read error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/state", (req, res) => {
  try {
    setState.run("app_state", JSON.stringify(req.body));
    if (req.body.months) syncArticles(req.body.months);
    res.json({ ok: true });
  } catch (e) {
    console.error("[DB] write error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get("/api/health", (_req, res) => {
  const { n } = db.prepare("SELECT COUNT(*) as n FROM articles").get();
  res.json({ ok: true, env: process.env.NODE_ENV || "development", db: DB_PATH, articles: n });
});

// ── Serve React build in production ─────────────────────────────
if (isProd) {
  const DIST = path.join(__dirname, "dist");
  app.use(express.static(DIST));
  app.get("*", (_req, res) => res.sendFile(path.join(DIST, "index.html")));
}

// ── Start ────────────────────────────────────────────────────────
app.listen(PORT, "0.0.0.0", () => {
  console.log(`[Blog Engine] ${isProd ? "Production" : "Dev"} server → http://0.0.0.0:${PORT}  DB: ${DB_PATH}`);
});
