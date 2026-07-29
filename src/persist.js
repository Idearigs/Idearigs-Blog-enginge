// Debounced, retrying state persistence.
//
// The previous version cleared the pending snapshot BEFORE issuing the
// request, never checked res.ok, and swallowed every error. Any failed save
// was therefore discarded permanently and silently — which is why deleting a
// month could look like it worked and then reappear on the next reload.
//
// Rules here:
//   - the pending snapshot is only dropped once the server confirms the write
//   - a failure retries with backoff instead of vanishing
//   - a newer snapshot always wins over an in-flight older one
//   - the caller is told the truth via onStatus so the UI can show it
//
// Kept React-free and injectable so the retry behaviour can be tested.

export const IDLE = "idle";
export const PENDING = "pending";
export const SAVING = "saving";
export const ERROR = "error";

export const createPersister = ({
  send,                       // async (state) => void, must throw on failure
  onStatus = () => {},
  debounceMs = 800,
  maxBackoffMs = 15000,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
} = {}) => {
  let pending = null;         // latest snapshot not yet confirmed saved
  let seq = 0;                // bumped on every save() so stale writes lose
  let inFlight = false;
  let attempt = 0;
  let timer = null;
  let status = IDLE;

  const setStatus = (next) => {
    if (next === status) return;
    status = next;
    onStatus(next);
  };

  const schedule = (ms) => {
    clearTimer(timer);
    timer = setTimer(() => { run(); }, ms);
  };

  // 1s, 2s, 4s, 8s, then capped — quick enough that a brief blip is invisible
  const backoff = () => Math.min(maxBackoffMs, 1000 * 2 ** Math.min(attempt - 1, 5));

  async function run() {
    if (pending === null) { setStatus(IDLE); return; }
    // Never overlap writes: the whole blob is replaced server-side, so two in
    // flight at once can land out of order and resurrect deleted records.
    if (inFlight) { schedule(200); return; }

    const snapshot = pending;
    const mySeq = seq;
    inFlight = true;
    setStatus(SAVING);

    try {
      await send(snapshot);
      attempt = 0;
      if (seq === mySeq) {
        pending = null;
        setStatus(IDLE);
      } else {
        // Something changed while we were saving — persist that too
        setStatus(PENDING);
        schedule(debounceMs);
      }
    } catch {
      attempt += 1;
      setStatus(ERROR);
      schedule(backoff());
    } finally {
      inFlight = false;
    }
  }

  return {
    save(state) {
      pending = state;
      seq += 1;
      attempt = 0;
      setStatus(PENDING);
      schedule(debounceMs);
    },
    /** Write immediately — used when the tab is hidden. */
    flush() {
      if (pending === null) return;
      schedule(0);
    },
    /** True while an edit has not been confirmed by the server. */
    hasUnsaved() { return pending !== null; },
    getStatus() { return status; },
  };
};
