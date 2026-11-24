// The only module that touches the network. Every request of a run goes through one fetcher,
// which counts it against the run's request budget, puts a timeout on it, follows redirects one
// hop at a time (so each hop is counted too), reads bodies only up to a byte cap while they
// stream, and cancels the bodies it doesn't need.

import { REDIRECT_STATUSES } from "redirect-inspector";

export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_USER_AGENT = "store-check (+https://github.com/idrisiRehan/websync-plugins)";
/** Redirects followed per fetch. RFC 9309 s2.3.1.2 asks crawlers to follow at least five for robots.txt. */
export const MAX_REDIRECTS = 5;
/** HTTP requests per run, redirects included. The README's request budget explains the number. */
export const MAX_REQUESTS = 20;

export interface FetchRecord {
  /** What the fetch was for, such as "robots.txt" or "product page". */
  purpose: string;
  url: string;
  /** The URL of the last request, after redirects. */
  finalUrl: string;
  /** Status of the last response, or null when no response arrived. */
  status: number | null;
  redirects: number;
  /** From the first request until the body was read, or until the headers arrived when it wasn't needed. */
  durationMs: number;
  /** Body bytes read (after HTTP decompression), or null when the body wasn't read. */
  bytes: number | null;
  /** Why the fetch failed or stopped early (timeout, network error, too many redirects, a body over the cap), or null. */
  error: string | null;
}

export interface Fetched {
  record: FetchRecord;
  /** Headers of the last response, or null when none arrived. */
  headers: Headers | null;
  /** The whole body of a 2xx response, or null when it wasn't read or the fetch failed. */
  body: Uint8Array | null;
}

export interface Fetcher {
  /** A fetch that counts each call against the budget, for inspectRedirects(). */
  fetch: typeof fetch;
  /** GETs a URL, following redirects, and reads a 2xx body up to maxBytes. Never throws. */
  get(url: string, purpose: string, accept: string, maxBytes: number): Promise<Fetched>;
  /** Requests made so far. */
  readonly used: number;
}

class BudgetError extends Error {
  constructor() {
    super(`not requested: store-check's limit of ${MAX_REQUESTS} requests per run was reached`);
  }
}

export function requestError(error: unknown, timeoutMs: number): string {
  if (error instanceof BudgetError) return error.message;
  if (!(error instanceof Error)) return String(error);
  if (error.name === "TimeoutError") return `timed out after ${timeoutMs} ms`;
  // A host with several addresses (localhost: ::1 and 127.0.0.1) fails with an AggregateError
  // whose message is empty, so fall back to its code (ECONNREFUSED).
  const cause = error.cause instanceof Error ? error.cause.message || (error.cause as { code?: string }).code : undefined;
  return cause ? `${error.message}: ${cause}` : error.message;
}

export function formatBytes(n: number): string {
  return n >= 1024 * 1024 ? `${n / (1024 * 1024)} MiB` : `${n / 1024} KiB`;
}

/** The body, or null once it passes maxBytes. Leaving the loop early cancels the stream. */
async function readCapped(body: AsyncIterable<Uint8Array>, maxBytes: number): Promise<Uint8Array | null> {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of body) {
    total += chunk.byteLength;
    if (total > maxBytes) return null;
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, total);
}

export function createFetcher(fetchFn: typeof fetch, timeoutMs: number, userAgent: string): Fetcher {
  let used = 0;
  const counted: typeof fetch = (input, init) => {
    if (used >= MAX_REQUESTS) return Promise.reject(new BudgetError());
    used++;
    return fetchFn(input, init);
  };

  async function get(url: string, purpose: string, accept: string, maxBytes: number): Promise<Fetched> {
    const record: FetchRecord = { purpose, url, finalUrl: url, status: null, redirects: 0, durationMs: 0, bytes: null, error: null };
    const begin = performance.now();
    const done = (headers: Headers | null, body: Uint8Array | null = null): Fetched => {
      record.durationMs = Math.round(performance.now() - begin);
      return { record, headers, body };
    };

    let current = new URL(url);
    for (;;) {
      record.finalUrl = current.href;
      let response: Response;
      try {
        response = await counted(current, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs), headers: { "user-agent": userAgent, accept } });
      } catch (error) {
        record.error = requestError(error, timeoutMs);
        return done(null);
      }
      record.status = response.status;
      const location = response.headers.get("location");
      if (!REDIRECT_STATUSES.has(response.status) || !location) {
        if (!response.ok) {
          await response.body?.cancel().catch(() => {});
          return done(response.headers);
        }
        try {
          const body = response.body ? await readCapped(response.body, maxBytes) : new Uint8Array();
          if (body === null) {
            record.error = `the body is larger than ${formatBytes(maxBytes)}, so store-check stopped reading it`;
            return done(response.headers);
          }
          record.bytes = body.byteLength;
          return done(response.headers, body);
        } catch (error) {
          record.error = requestError(error, timeoutMs);
          return done(response.headers);
        }
      }

      await response.body?.cancel().catch(() => {});
      let next: URL | null = null;
      try {
        next = new URL(location, current);
      } catch {
        // Reported below.
      }
      if (!next || (next.protocol !== "http:" && next.protocol !== "https:")) {
        record.error = `redirects to "${location}", which is not an http or https URL`;
        return done(response.headers);
      }
      if (record.redirects === MAX_REDIRECTS) {
        record.error = `still redirecting after ${MAX_REDIRECTS} redirects`;
        return done(response.headers);
      }
      record.redirects++;
      current = next;
    }
  }

  return {
    fetch: counted,
    get,
    get used() {
      return used;
    },
  };
}
