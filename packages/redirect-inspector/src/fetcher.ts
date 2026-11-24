// createFetcher(): the GET client shared by the repository's tools that read pages and files.
// Every request counts against an optional budget and has a timeout. Redirects are followed one
// hop at a time with redirect: "manual", so each hop is counted too, and only to http and https
// URLs, never in a loop. A 2xx body is read only up to a byte cap while it streams (after HTTP
// decompression); every other body is cancelled unread.

// The statuses that browsers follow automatically (the Fetch Standard's "redirect status").
// RFC 9110 s15.4 lets a client follow any 3xx with a Location, but 300, 304, 305 and 306 are
// not moves, and no browser follows them.
export const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Redirects followed per get. RFC 9309 s2.3.1.2 asks robots.txt readers to follow at least five. */
export const DEFAULT_MAX_REDIRECTS = 5;

export interface FetcherOptions {
  /** A fetch implementation, for tests or a custom agent. Defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Timeout for each request in milliseconds, body included. */
  timeoutMs: number;
  userAgent: string;
  /** Requests allowed in all, redirects included (default: no limit). */
  maxRequests?: number;
  /** Redirects followed per get (default 5). */
  maxRedirects?: number;
  /** The error of a request refused by maxRequests (default "not requested: the run's limit of n requests was reached"). */
  budgetError?: string;
}

export interface GetOptions {
  /** Body bytes to read, after HTTP decompression. A larger body stops being read and is an error. */
  maxBytes: number;
  /** The Accept header, if any. */
  accept?: string;
  /** The error of a body over maxBytes (default "the body is larger than n bytes, so reading stopped"). */
  tooLargeError?: string;
  /**
   * Shares hops with earlier gets that cached theirs with the same read function, accept,
   * maxBytes and tooLargeError: each URL is then requested once, and URLs that redirect to the
   * same page share its response.
   */
  cacheHops?: boolean;
}

/** Turns a 2xx body into the result's body. A cached hop keeps only what this returns. */
export type BodyReader<T> = (body: Uint8Array, headers: Headers, url: string) => T;

export interface FetchRecord {
  /** The URL asked for. */
  url: string;
  /** The URL of the last request, after redirects, without a fragment. */
  finalUrl: string;
  /** Status of the last request's response, or null when it got none. */
  status: number | null;
  redirects: number;
  /** Time the requests took, from sending each until its body was read. A shared hop counts its original time. */
  durationMs: number;
  /** Body bytes read (after HTTP decompression), or null when the body wasn't read. */
  bytes: number | null;
  /**
   * Why the get failed or stopped early (a timeout, a network error, a redirect to a non-http URL
   * or to several different Locations, a loop, too many redirects, a body over the cap, the
   * budget, an error thrown by read), or null. A response that isn't
   * 2xx is not an error: its status says what happened.
   */
  error: string | null;
}

export interface Fetched<T> {
  record: FetchRecord;
  /** Headers of the last response, or null when none arrived. */
  headers: Headers | null;
  /** The whole body of a 2xx response (as `read` returned it), or null when it wasn't read or the get failed. */
  body: T | null;
}

export interface Fetcher {
  /** GETs a URL, following redirects, and reads a 2xx body up to maxBytes. Never throws: every problem is in the record. */
  get<T>(url: string, options: GetOptions & { read: BodyReader<T> }): Promise<Fetched<T>>;
  get(url: string, options: GetOptions): Promise<Fetched<Uint8Array>>;
  /** The fetch behind get(), counted against maxRequests, for other code that shares the budget (such as inspectRedirects()). */
  readonly fetch: typeof fetch;
  /** Requests made so far. */
  readonly used: number;
}

/** One request's outcome. */
interface Hop {
  status: number | null;
  /** The Location of a redirect, or null when the response ends the chain. */
  location: string | null;
  headers: Headers | null;
  bytes: number | null;
  body: unknown;
  error: string | null;
  durationMs: number;
}

/** A request's failure in one line: "timed out after 300 ms", "fetch failed: ECONNREFUSED". */
export function requestError(error: unknown, timeoutMs: number): string {
  if (!(error instanceof Error)) return String(error);
  if (error.name === "TimeoutError") return `timed out after ${timeoutMs} ms`;
  // A host with several addresses (localhost: ::1 and 127.0.0.1) fails with an AggregateError
  // whose message is empty, so fall back to its code (ECONNREFUSED).
  const cause = error.cause instanceof Error ? error.cause.message || (error.cause as { code?: string }).code : undefined;
  return cause ? `${error.message}: ${cause}` : error.message;
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

/** The URL with its fragment removed (fragments never reach the server), or null when it isn't http or https. */
function httpUrl(input: string, base?: URL): URL | null {
  let url: URL;
  try {
    url = new URL(input, base);
  } catch {
    return null;
  }
  url.hash = "";
  return url.protocol === "http:" || url.protocol === "https:" ? url : null;
}

// fetch decodes header bytes as Latin-1, so a Location sent as raw UTF-8 instead of
// percent-encoded arrives garbled. Browsers and undici read it as UTF-8, so do the same.
export function decodeLocation(value: string): string {
  if (!/^[\x00-\xff]*$/.test(value) || !/[\x80-\xff]/.test(value)) return value;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(value, (c) => c.charCodeAt(0)));
  } catch {
    return value;
  }
}

// fetch joins repeated headers with ", ", which a valid Location can't contain (spaces must be
// percent-encoded). Repeats of one value are harmless; different ones are refused by Chrome
// (ERR_RESPONSE_HEADERS_MULTIPLE_LOCATION), and other clients pick one.
/** The different targets in a (decoded) Location header: one, unless the response sent several. */
export function locationTargets(location: string): string[] {
  return [...new Set(location.split(", ").map((t) => t.trim()))];
}

function wholeNumber(name: string, value: number, min: number): void {
  if (!Number.isInteger(value) || value < min) throw new RangeError(`${name} must be a whole number, ${min} or more.`);
}

/** A fetcher for one run: every get shares its request budget and hop cache. Throws only for bad options. */
export function createFetcher(options: FetcherOptions): Fetcher {
  const { timeoutMs, userAgent, maxRequests = Infinity, maxRedirects = DEFAULT_MAX_REDIRECTS } = options;
  wholeNumber("timeoutMs", timeoutMs, 1);
  wholeNumber("maxRedirects", maxRedirects, 0);
  if (maxRequests !== Infinity) wholeNumber("maxRequests", maxRequests, 0);
  const budgetError = options.budgetError ?? `not requested: the run's limit of ${maxRequests} requests was reached`;
  // Cached hops by read function, then by the options that change a hop's result and the URL.
  const caches = new Map<BodyReader<unknown> | undefined, Map<string, Promise<Hop>>>();
  let used = 0;

  const counted: typeof fetch = (input, init) => {
    if (used >= maxRequests) return Promise.reject(new Error(budgetError));
    used++;
    return (options.fetch ?? fetch)(input, init);
  };

  async function request(url: string, opts: GetOptions & { read?: BodyReader<unknown> }): Promise<Hop> {
    const hop: Hop = { status: null, location: null, headers: null, bytes: null, body: null, error: null, durationMs: 0 };
    const headers: Record<string, string> = { "user-agent": userAgent };
    if (opts.accept) headers.accept = opts.accept;
    const begin = performance.now();
    try {
      const response = await counted(url, { redirect: "manual", signal: AbortSignal.timeout(timeoutMs), headers });
      hop.status = response.status;
      hop.headers = response.headers;
      const location = response.headers.get("location");
      if (REDIRECT_STATUSES.has(response.status) && location) hop.location = decodeLocation(location);
      if (hop.location !== null || !response.ok) {
        await response.body?.cancel().catch(() => {});
      } else {
        const body = response.body ? await readCapped(response.body, opts.maxBytes) : new Uint8Array();
        if (body === null) {
          hop.error = opts.tooLargeError ?? `the body is larger than ${opts.maxBytes} bytes, so reading stopped`;
        } else {
          hop.bytes = body.byteLength;
          hop.body = opts.read ? opts.read(body, response.headers, url) : body;
        }
      }
    } catch (error) {
      hop.error = requestError(error, timeoutMs);
    }
    hop.durationMs = performance.now() - begin;
    return hop;
  }

  async function get(url: string, opts: GetOptions & { read?: BodyReader<unknown> }): Promise<Fetched<unknown>> {
    const record: FetchRecord = { url, finalUrl: url, status: null, redirects: 0, durationMs: 0, bytes: null, error: null };
    let current = httpUrl(url);
    if (!current) {
      record.error = "not an absolute http or https URL";
      return { record, headers: null, body: null };
    }
    let cache: Map<string, Promise<Hop>> | undefined;
    if (opts.cacheHops) {
      cache = caches.get(opts.read);
      if (!cache) caches.set(opts.read, (cache = new Map()));
    }
    const seen = new Set<string>();
    let elapsed = 0;
    for (;;) {
      const href = current.href;
      seen.add(href);
      record.finalUrl = href;
      const key = JSON.stringify([opts.accept ?? null, opts.maxBytes, opts.tooLargeError ?? null, href]);
      let pending = cache?.get(key);
      if (!pending) {
        pending = request(href, opts);
        cache?.set(key, pending);
      }
      const hop = await pending;
      elapsed += hop.durationMs;
      record.durationMs = Math.round(elapsed);
      record.status = hop.status;
      record.error = hop.error;
      if (hop.location === null) {
        record.bytes = hop.bytes;
        return { record, headers: hop.headers, body: hop.body };
      }

      const stop = (error: string): Fetched<unknown> => {
        record.error = error;
        return { record, headers: hop.headers, body: null };
      };
      const targets = locationTargets(hop.location);
      if (targets.length > 1) return stop(`redirects to ${targets.length} different Locations at once`);
      const next = httpUrl(targets[0], current);
      if (!next) return stop(`redirects to "${hop.location}", which is not an http or https URL`);
      if (seen.has(next.href)) return stop(`redirects in a loop (back to ${next.href})`);
      if (record.redirects === maxRedirects) return stop(`still redirecting after ${maxRedirects} redirects`);
      record.redirects++;
      current = next;
    }
  }

  return {
    get: get as Fetcher["get"],
    fetch: counted,
    get used() {
      return used;
    },
  };
}
