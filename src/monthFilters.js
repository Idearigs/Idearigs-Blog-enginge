// Month key helpers and the filtering/rollup used by the Months page.
// Kept free of React so the selection logic can be tested directly.

export const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

/**
 * A month key is "<period>__<owner>", e.g. "2026-01__a3f9c1b2".
 *
 * It used to be the bare period, which meant the months map could hold only
 * one January 2026 for the whole app — a second client's January silently
 * overwrote the first. The owner segment makes the key unique per client.
 * Keys without a separator are pre-migration records and still readable.
 */
export const MONTH_KEY_SEP = "__";

/** The calendar month a key belongs to: "2026-01__a3f9" -> "2026-01" */
export const monthPeriod = (key) => String(key || "").split(MONTH_KEY_SEP)[0];

/** The owner segment, "" for a legacy key. */
export const monthOwner = (key) => String(key || "").split(MONTH_KEY_SEP)[1] || "";

export const makeMonthKey = (period, owner) => `${monthPeriod(period)}${MONTH_KEY_SEP}${owner}`;

/** The period an <input type="month"> should default to. */
export const getMonthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;

export const getMonthLabel = (key) => {
  const [y, m] = monthPeriod(key).split("-");
  return `${MONTHS[parseInt(m, 10) - 1] || key} ${y || ""}`.trim();
};

/**
 * Rewrite legacy bare-period keys to "<period>__<clientId>" so a second client
 * can own the same calendar month. Article ids are re-prefixed to match,
 * because they are the primary key of the articles table and would otherwise
 * collide between two clients' Januaries. Payments follow their month.
 *
 * Idempotent: keys that already carry a separator are left untouched.
 */
export const migrateMonthKeys = (
  { months = {}, payments = [] } = {},
  newSuffix = () => Math.random().toString(36).slice(2, 10)
) => {
  const legacy = Object.keys(months).filter(k => !String(k).includes(MONTH_KEY_SEP));
  if (!legacy.length) return { months, payments, renamed: {} };

  const taken = new Set(Object.keys(months));
  const renamed = {};
  const next = {};

  for (const k of Object.keys(months)) {
    if (String(k).includes(MONTH_KEY_SEP)) next[k] = months[k];
  }

  for (const oldKey of legacy) {
    const md = months[oldKey] || {};
    let key = makeMonthKey(oldKey, md.clientId || `none-${newSuffix()}`);
    // A client that somehow already owns this period keeps it; the straggler
    // gets a unique suffix rather than being silently dropped.
    while (taken.has(key) || next[key]) key = makeMonthKey(oldKey, `${md.clientId || "none"}-${newSuffix()}`);
    taken.add(key);
    renamed[oldKey] = key;

    next[key] = {
      ...md,
      articles: (md.articles || []).map((a, i) => ({
        ...a,
        id: typeof a?.id === "string" && a.id.startsWith(`${oldKey}-`) ? `${key}-${i}` : a?.id,
      })),
    };
  }

  return {
    months: next,
    payments: (payments || []).map(p => (renamed[p?.monthKey] ? { ...p, monthKey: renamed[p.monthKey] } : p)),
    renamed,
  };
};

const paymentFor = (payments, key) =>
  (payments || []).find(p => p.monthKey === key) || { status: "unpaid" };

/**
 * Select and order month keys for the Months page.
 * `clientId` "" means any client; `status` "all" means any payment status.
 */
export const filterMonths = ({
  months = {},
  payments = [],
  clients = [],
  sites = [],
  clientId = "",
  status = "all",
  search = "",
  sort = "newest",
} = {}) => {
  const clientName = (id) => clients.find(c => c.id === id)?.name || "";
  const siteName   = (id) => sites.find(s => s.id === id)?.name || "";
  const q = String(search).trim().toLowerCase();

  return Object.keys(months)
    .filter(key => {
      const md = months[key];
      if (!md) return false;
      if (clientId && (md.clientId || "") !== clientId) return false;
      if (status !== "all" && (paymentFor(payments, key).status || "unpaid") !== status) return false;
      if (q) {
        // The owner segment of the key is an internal id — searching it would
        // match nothing a user could type, so only the period is included.
        const haystack = [getMonthLabel(key), monthPeriod(key), clientName(md.clientId), siteName(md.siteId)]
          .join(" ").toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      // Several clients can now share a period, so ties break on client name
      // rather than on the opaque owner id.
      const an = clientName(months[a].clientId);
      const bn = clientName(months[b].clientId);
      const pa = monthPeriod(a);
      const pb = monthPeriod(b);

      if (sort === "oldest") return pa.localeCompare(pb) || an.localeCompare(bn);
      if (sort === "client") {
        // Unassigned months go last. Checked explicitly rather than via a
        // sentinel string: localeCompare orders punctuation before letters,
        // so "~" would sort them first.
        if (!an !== !bn) return an ? -1 : 1;
        return an.localeCompare(bn) || pb.localeCompare(pa);
      }
      return pb.localeCompare(pa) || an.localeCompare(bn); // newest
    });
};

/** Totals across the currently visible months. */
export const rollupMonths = ({ keys = [], months = {}, payments = [], liveStatuses = [] } = {}) =>
  keys.reduce((acc, key) => {
    const pay = paymentFor(payments, key);
    const arts = months[key]?.articles || [];
    acc.articles += arts.length;
    acc.live     += arts.filter(a => liveStatuses.includes(a.status)).length;
    if (pay.status === "paid") acc.paid += pay.amount || 0;
    else acc.outstanding += pay.amount || 0;
    return acc;
  }, { articles: 0, live: 0, paid: 0, outstanding: 0 });
