// Follows a URL's redirect chain one hop at a time (fetch with redirect: "manual") and reports
// problems with each hop and with the chain as a whole. Status code semantics are from
// RFC 9110 (https://www.rfc-editor.org/rfc/rfc9110.html), cited by section below.

/**
 * Google's crawlers follow up to 10 redirect hops by default ("How HTTP status codes, and
 * network and DNS errors affect Google Search", section 3xx:
 * https://developers.google.com/search/docs/crawling-indexing/http-network-errors).
 */
export const DEFAULT_MAX_HOPS = 10;
export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_USER_AGENT = "redirect-inspector (+https://github.com/idrisiRehan/websync-plugins)";

// The statuses that browsers follow automatically (the Fetch Standard's "redirect status").
// RFC 9110 s15.4 lets a client follow any 3xx with a Location, but 300, 304, 305 and 306 are
// not moves, and no browser follows them.
export const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
// 302 (s15.4.3), 303 (s15.4.4) and 307 (s15.4.8) say the move is temporary or indirect.
// Google treats them as a weak signal and keeps the original URL in results.
const TEMPORARY_STATUSES = new Set([302, 303, 307]);

export type Severity = "error" | "warning";

export type RuleId =
  | "request-failed"
  | "location-missing"
  | "location-invalid"
  | "location-scheme"
  | "location-multiple"
  | "redirect-loop"
  | "too-many-hops"
  | "https-downgrade"
  | "https-missing"
  | "redirect-temporary"
  | "redirect-chain"
  | "final-status"
  | "final-3xx";

export interface RedirectHop {
  url: string;
  status: number;
  statusText: string;
  /** The Location header as sent (raw UTF-8 decoded), or null when there is none. */
  location: string | null;
  /** Time until the response headers arrived. */
  durationMs: number;
}

export interface RedirectFinding {
  rule: RuleId;
  severity: Severity;
  message: string;
  /** 1-based position in `hops` of the response the finding is about, or null for the whole chain. */
  hop: number | null;
}

export interface RedirectResult {
  /** The URL the chain started from. */
  url: string;
  hops: RedirectHop[];
  /** Where the chain ended: the last response, or the URL whose request failed. */
  finalUrl: string;
  /** Status of the last response, or null when the last request failed. */
  finalStatus: number | null;
  /** True when there are no errors. Warnings don't make a chain invalid. */
  valid: boolean;
  findings: RedirectFinding[];
  errorCount: number;
  warningCount: number;
}

export interface InspectOptions {
  /** Redirects to follow before giving up (default 10, Googlebot's limit). */
  maxHops?: number;
  /** Timeout for each request in milliseconds (default 10000). */
  timeoutMs?: number;
  userAgent?: string;
  /** GET (default) cancels each body unread. HEAD avoids bodies, but some servers answer it differently. */
  method?: "GET" | "HEAD";
  /** A fetch implementation, for tests or a custom agent. Defaults to the global fetch. */
  fetch?: typeof fetch;
}

function toHttpUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new TypeError(`Not a valid absolute URL: ${input}`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new TypeError(`Only http and https URLs can be inspected: ${input}`);
  return url;
}

// Fragments never reach the server, so two URLs that differ only there are the same request.
// url.hash is "" for an empty fragment ("/page#"), so cut at the "#" itself.
function withoutHash(url: URL): string {
  return url.href.split("#", 1)[0];
}

// fetch decodes header bytes as Latin-1, so a Location sent as raw UTF-8 instead of
// percent-encoded arrives garbled. Browsers and undici read it as UTF-8, so do the same.
function decodeLocation(value: string): string {
  if (!/^[\x00-\xff]*$/.test(value) || !/[\x80-\xff]/.test(value)) return value;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(value, (c) => c.charCodeAt(0)));
  } catch {
    return value;
  }
}

function requestError(error: unknown, timeoutMs: number): string {
  if (!(error instanceof Error)) return String(error);
  if (error.name === "TimeoutError") return `timed out after ${timeoutMs} ms`;
  // A host with several addresses (localhost: ::1 and 127.0.0.1) fails with an AggregateError
  // whose message is empty, so fall back to its code (ECONNREFUSED).
  const cause = error.cause instanceof Error ? error.cause.message || (error.cause as { code?: string }).code : undefined;
  return cause ? `${error.message}: ${cause}` : error.message;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Follows the redirects from `url` and reports problems. A failed request becomes a finding; only a bad start URL or bad options throw. */
export async function inspectRedirects(url: string, options: InspectOptions = {}): Promise<RedirectResult> {
  const { maxHops = DEFAULT_MAX_HOPS, timeoutMs = DEFAULT_TIMEOUT_MS, userAgent = DEFAULT_USER_AGENT, method = "GET" } = options;
  const fetchFn = options.fetch ?? fetch;
  if (!Number.isInteger(maxHops) || maxHops < 0) throw new RangeError("maxHops must be a whole number, 0 or more.");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) throw new RangeError("timeoutMs must be a whole number, 1 or more.");

  const start = toHttpUrl(url);
  const hops: RedirectHop[] = [];
  const findings: RedirectFinding[] = [];
  const report = (rule: RuleId, severity: Severity, message: string, hop: number | null) => findings.push({ rule, severity, message, hop });
  const visited = new Set<string>();
  let current = start;
  let failedUrl: string | null = null;
  // True once a response that isn't a redirect ends the chain.
  let completed = false;

  for (;;) {
    visited.add(withoutHash(current));
    const begin = performance.now();
    let response: Response;
    try {
      response = await fetchFn(current, { method, redirect: "manual", signal: AbortSignal.timeout(timeoutMs), headers: { "user-agent": userAgent } });
    } catch (error) {
      failedUrl = current.href;
      report("request-failed", "error", `Request to ${current.href} failed: ${requestError(error, timeoutMs)}.`, null);
      break;
    }
    const durationMs = Math.round(performance.now() - begin);
    // Only the status line and headers matter, so the body is never downloaded.
    await response.body?.cancel().catch(() => {});
    if (response.type === "opaqueredirect") {
      throw new Error("This fetch hides redirect responses (browsers do), so redirects can't be inspected here. Use Node.js.");
    }

    const header = response.headers.get("location");
    const location = header === null ? null : decodeLocation(header);
    hops.push({ url: current.href, status: response.status, statusText: response.statusText, location, durationMs });
    const hop = hops.length;
    const status = response.status;

    if (!REDIRECT_STATUSES.has(status)) {
      completed = true;
      break;
    }
    // 301, 302, 307 and 308 "SHOULD generate a Location" (RFC 9110 s15.4.2, s15.4.3, s15.4.8,
    // s15.4.9) and 303 redirects "as indicated by a URI in the Location header field" (s15.4.4).
    // Without one there is nowhere to go.
    if (!location?.trim()) {
      report("location-missing", "error", `${status} has no Location header, so clients have nowhere to go.`, hop);
      break;
    }
    // fetch joins repeated headers with ", ", which a valid Location can't contain (spaces must
    // be percent-encoded). Repeats of one value are harmless; different ones are refused by
    // Chrome (ERR_RESPONSE_HEADERS_MULTIPLE_LOCATION), and other clients pick one.
    const targets = [...new Set(location.split(", ").map((t) => t.trim()))];
    if (targets.length > 1) {
      report("location-multiple", "error", `${status} gives ${targets.length} different Locations (${targets.map((t) => `"${t}"`).join(", ")}). Chrome refuses the redirect, and other clients may follow either one. Send one Location header.`, hop);
      break;
    }
    // Location is a URI-reference; a relative one is resolved against the request URL
    // (RFC 9110 s10.2.2), so relative values are legal and are not reported.
    let next: URL;
    try {
      next = new URL(targets[0], current);
    } catch {
      report("location-invalid", "error", `Location "${location}" is not a valid URL.`, hop);
      break;
    }
    if (next.protocol !== "http:" && next.protocol !== "https:") {
      report("location-scheme", "error", `Location "${location}" uses the ${next.protocol.slice(0, -1)} scheme. Browsers and crawlers only follow redirects to http and https.`, hop);
      break;
    }
    // A Location without a fragment inherits the request's fragment (RFC 9110 s10.2.2). An empty
    // fragment ("/page#") is still one, though url.hash is "" for it as for none.
    if (!next.href.includes("#") && current.hash) next.hash = current.hash;
    if (current.protocol === "https:" && next.protocol === "http:") {
      report("https-downgrade", "error", `Redirects from HTTPS to plain HTTP (${next.href}). The next request can be read or changed in transit.`, hop);
    }
    // "A client SHOULD detect and intervene in cyclical redirections" (RFC 9110 s15.4).
    if (visited.has(withoutHash(next))) {
      report("redirect-loop", "error", `Redirects back to ${next.href}, which is already in the chain: a redirect loop. Browsers stop with a "too many redirects" error.`, hop);
      break;
    }
    if (hop > maxHops) {
      report("too-many-hops", "error", `Still redirecting after ${plural(maxHops, "redirect")}, so inspection stopped. Google's crawlers follow up to 10 hops.`, hop);
      break;
    }
    current = next;
  }

  const last = hops.at(-1);
  const finalStatus = failedUrl === null && last ? last.status : null;
  const finalUrl = failedUrl ?? last?.url ?? start.href;
  const resolved = completed && finalStatus !== null && finalStatus >= 200 && finalStatus < 300;

  if (completed && finalStatus !== null && !resolved) {
    if (finalStatus === 304) {
      // 304 answers a conditional request (RFC 9110 s15.4.5). This request had no validators,
      // so the server sent no content where it should have sent the page.
      report("final-3xx", "error", "Ends in 304 Not Modified, but the request was not conditional, so there is no page to show.", hops.length);
    } else if (finalStatus >= 300 && finalStatus < 400) {
      report("final-3xx", "error", `Ends in ${finalStatus}, which browsers and crawlers don't follow as a redirect (only 301, 302, 303, 307 and 308 are).`, hops.length);
    } else {
      report("final-status", "error", `Ends in ${finalStatus}${last?.statusText ? ` ${last.statusText}` : ""}, not a 2xx success.`, hops.length);
    }
  }

  if (resolved) {
    // A temporary redirect can be intended (a login page, a campaign), so it is only reported
    // when the chain ends at a working page, which loop detection guarantees is a different
    // URL, and the advice is conditional.
    hops.forEach((h, i) => {
      if (!TEMPORARY_STATUSES.has(h.status)) return;
      report("redirect-temporary", "warning", `${h.status} is a temporary redirect, so search engines keep treating ${h.url} as the main URL. If the move is permanent, use 301 or 308.`, i + 1);
    });
    const redirects = hops.length - 1;
    if (redirects > 1) {
      report("redirect-chain", "warning", `${redirects} redirects in a row. Point the first URL directly to the final one (${finalUrl}).`, null);
    }
  }

  if (completed && start.protocol === "http:" && hops.every((h) => h.url.startsWith("http:"))) {
    report("https-missing", "warning", `${start.href} is plain HTTP and never redirects to HTTPS.`, null);
  }

  const errorCount = findings.filter((f) => f.severity === "error").length;
  return { url: start.href, hops, finalUrl, finalStatus, valid: errorCount === 0, findings, errorCount, warningCount: findings.length - errorCount };
}
