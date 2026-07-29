// Publish scheduling. scheduledAt is stored as a UTC instant; the user picks a
// local date and time and WordPress is handed a naive UTC stamp via date_gmt.
// Kept React-free so the timezone handling can be unit tested.

/**
 * One article per slot, a day skipped between each:
 * article 1 → startDate, article 2 → startDate+2, article 3 → startDate+4 …
 * `time` is local ("09:00"); the returned values are full ISO UTC instants.
 */
export const buildSchedule = (startDate, time, count = 10) => {
  const [h, m] = String(time || "09:00").split(":").map(Number);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(`${startDate}T00:00:00`);
    d.setDate(d.getDate() + i * 2);
    d.setHours(h || 0, m || 0, 0, 0);
    return d.toISOString();
  });
};

/**
 * Records written before this was fixed stored the UTC instant WITHOUT the
 * trailing "Z", and JS reads a bare "2026-08-01T03:30:00" as local time. That
 * shifted every displayed schedule by the UTC offset and made an article less
 * than one offset away look like it was in the past, so it published
 * immediately instead of being scheduled. Re-attach the Z when it is missing.
 */
export const parseSchedule = (s) => {
  if (!s) return null;
  const str = String(s);
  const d = new Date(/(Z|[+-]\d{2}:?\d{2})$/.test(str) ? str : `${str}Z`);
  return isNaN(d.getTime()) ? null : d;
};

/** WordPress date_gmt wants a naive UTC timestamp: "2026-08-01T03:30:00". */
export const toGmtStamp = (s) => {
  const d = parseSchedule(s);
  return d ? d.toISOString().slice(0, 19) : null;
};

export const isFuture = (s, now = new Date()) => {
  const d = parseSchedule(s);
  return !!d && d > now;
};

/** Client name → safe filename fragment: "Alpha Travel (Pvt)" → "alpha-travel-pvt" */
export const slugifyName = (s) =>
  String(s || "").trim().toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
