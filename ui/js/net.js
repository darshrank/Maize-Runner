// One fetch path for every loader (data.js). python -m http.server resets connections under bursts of parallel
// requests, and a reset used to fail quietly to null (a config could drop out of Results). Here:
//   at most MAX_IN_FLIGHT requests at once (the slot is held until the body is read);
//   network errors and connection resets are retried after RETRY_MS (200 ms, then 600 ms);
//   HTTP 404 is "missing" and returns null (files that may be absent keep their quiet placeholders);
//   any other failure after the retries returns a LoadError, never null.
// Every LoadError is listed in loadFailures() until the same URL loads (or 404s) on a later request; the UI shows
// the list in one card (main.js).

const MAX_IN_FLIGHT = 4;
const RETRY_MS = [200, 600];

export class LoadError extends Error {
  constructor(url, reason) {
    super(`${url}: ${reason}`);
    this.name = "LoadError";
    this.url = url;
    this.reason = reason;
  }
}

// ---------------------------------------------------------------- failure list

const failures = new Map();   // url -> LoadError
const listeners = new Set();

function note(url, err) {
  if (err) failures.set(url, err);
  else if (!failures.delete(url)) return;
  for (const fn of listeners) fn();
}

// A failure found after the bytes arrived (e.g. a JSON file that does not parse): recorded like a fetch failure.
export function fail(url, reason) {
  const err = new LoadError(url, reason);
  note(url, err);
  return err;
}

export function loadFailures() {
  return [...failures.values()];
}

export function onLoadFailures(fn) {
  listeners.add(fn);
}

// ---------------------------------------------------------------- concurrency

let inFlight = 0;
const waiting = [];

async function acquire() {
  if (inFlight < MAX_IN_FLIGHT) { inFlight++; return; }
  await new Promise((resolve) => waiting.push(resolve));   // the slot is handed over by release()
}

function release() {
  const next = waiting.shift();
  if (next) next(); else inFlight--;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------- request

// GET: the body text. HEAD: true. null on HTTP 404. A LoadError for anything else after the retries.
export async function request(url, { method = "GET" } = {}) {
  let reason = "";
  for (let attempt = 0; attempt <= RETRY_MS.length; attempt++) {
    if (attempt) await sleep(RETRY_MS[attempt - 1]);
    await acquire();
    let res = null;
    try {
      res = await fetch(url, { method, cache: "no-store" });
      if (res.status === 404) { note(url, null); return null; }
      if (!res.ok) return fail(url, `HTTP ${res.status}`);
      const value = method === "HEAD" ? true : await res.text();
      note(url, null);
      return value;
    } catch {
      // fetch() rejects on network errors and resets; res.text() rejects when the connection drops mid-body.
      reason = res ? "connection dropped while reading" : "network error or connection reset";
    } finally {
      release();
    }
  }
  return fail(url, `${reason} (${RETRY_MS.length + 1} tries)`);
}
