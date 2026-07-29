// API keys and WordPress application passwords never leave the server.
// The browser receives "••••••••abcd" placeholders instead; when a save comes
// back carrying a placeholder we restore the real value from the database.
const MASK = "••••••••";

const mask     = (v) => (v ? MASK + String(v).slice(-4) : "");
const isMasked = (v) => typeof v === "string" && v.startsWith(MASK);

// Records written before multi-key rotation kept a single `unsplashAccessKey`.
// Fold it into the list here so the server, and not the browser, owns the
// migration — the browser only ever sees masked values and could not do it.
const unsplashKeysOf = (cfg = {}) => {
  const list = (cfg.unsplashKeys || []).filter(Boolean);
  if (list.length) return list;
  return cfg.unsplashAccessKey ? [cfg.unsplashAccessKey] : [];
};

const redactState = (state) => {
  const out = { ...state };
  if (out.config) {
    out.config = {
      ...out.config,
      grokKey: mask(out.config.grokKey),
      unsplashKeys: unsplashKeysOf(out.config).map(mask),
      ...(out.config.unsplashAccessKey && { unsplashAccessKey: mask(out.config.unsplashAccessKey) }),
    };
  }
  if (Array.isArray(out.sites)) {
    out.sites = out.sites.map(s => ({ ...s, appPass: mask(s.appPass) }));
  }
  return out;
};

const unmaskState = (incoming, stored) => {
  const out = { ...incoming };
  const storedCfg = (stored && stored.config) || {};

  if (out.config) {
    const cfg = { ...out.config };
    if (isMasked(cfg.grokKey)) cfg.grokKey = storedCfg.grokKey || "";
    if (isMasked(cfg.unsplashAccessKey)) cfg.unsplashAccessKey = storedCfg.unsplashAccessKey || "";
    if (Array.isArray(cfg.unsplashKeys)) {
      const prev = unsplashKeysOf(storedCfg);
      cfg.unsplashKeys = cfg.unsplashKeys
        .map((k, i) => {
          if (!isMasked(k)) return k;
          const tail = k.slice(MASK.length);
          // Match on the visible tail so reordering/removing keys stays correct
          return prev.find(p => String(p).slice(-4) === tail) || prev[i] || "";
        })
        .filter(Boolean);
    }
    out.config = cfg;
  }

  if (Array.isArray(out.sites)) {
    const prevSites = (stored && stored.sites) || [];
    out.sites = out.sites.map(s => {
      if (!isMasked(s.appPass)) return s;
      return { ...s, appPass: prevSites.find(x => x.id === s.id)?.appPass || "" };
    });
  }

  return out;
};

module.exports = { MASK, mask, isMasked, redactState, unmaskState, unsplashKeysOf };
