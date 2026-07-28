// Month key helpers and the filtering/rollup used by the Months page.
// Kept free of React so the selection logic can be tested directly.

export const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

export const getMonthKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;

export const getMonthLabel = (key) => {
  const [y, m] = String(key).split("-");
  return `${MONTHS[parseInt(m,10)-1] || key} ${y}`;
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
        const haystack = [getMonthLabel(key), key, clientName(md.clientId), siteName(md.siteId)]
          .join(" ").toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (sort === "oldest") return a.localeCompare(b);
      if (sort === "client") {
        // Unassigned months go last. Checked explicitly rather than via a
        // sentinel string: localeCompare orders punctuation before letters,
        // so "~" would sort them first.
        const an = clientName(months[a].clientId);
        const bn = clientName(months[b].clientId);
        if (!an !== !bn) return an ? -1 : 1;
        return an.localeCompare(bn) || b.localeCompare(a);
      }
      return b.localeCompare(a); // newest
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
