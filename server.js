const express = require("express");
const cors    = require("cors");
const path    = require("path");
const { Pool } = require("pg");

const isProd = process.env.NODE_ENV === "production";
const PORT   = parseInt(process.env.PORT || (isProd ? "3000" : "3001"), 10);

const app = express();

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

const syncArticles = async (months) => {
  if (!months) return;
  for (const [monthKey, monthData] of Object.entries(months)) {
    for (const a of (monthData.articles || [])) {
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
    }
  }
};

// ── Middleware ───────────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: "100mb" }));

// ── API Routes ───────────────────────────────────────────────────
app.get("/api/state", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT value FROM app_state WHERE key = 'main'");
    res.json(rows[0]?.value || {});
  } catch (e) {
    console.error("[DB] read error:", e.message);
    res.status(500).json({ error: e.message });
  }
});

app.post("/api/state", async (req, res) => {
  try {
    await pool.query(`
      INSERT INTO app_state (key, value, updated_at) VALUES ('main', $1, NOW())
      ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()
    `, [req.body]);
    syncArticles(req.body.months).catch(e => console.error("[DB] sync error:", e.message));
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

// ── Serve React build in production ─────────────────────────────
if (isProd) {
  const DIST = path.join(__dirname, "dist");
  app.use(express.static(DIST));
  app.get("/{*path}", (_req, res) => res.sendFile(path.join(DIST, "index.html")));
}

// ── Start ────────────────────────────────────────────────────────
const start = async () => {
  await initDB();
  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Blog Engine] ${isProd ? "Production" : "Dev"} → http://0.0.0.0:${PORT}`);
  });
};

start().catch(e => { console.error("[FATAL]", e.message); process.exit(1); });
