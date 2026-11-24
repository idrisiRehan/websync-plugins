export { inspectRedirects, DEFAULT_MAX_HOPS, DEFAULT_TIMEOUT_MS, DEFAULT_USER_AGENT } from "./inspect.ts";
export type { InspectOptions, RedirectFinding, RedirectHop, RedirectResult, RuleId, Severity } from "./inspect.ts";
export { createFetcher, DEFAULT_MAX_REDIRECTS, REDIRECT_STATUSES } from "./fetcher.ts";
export type { BodyReader, Fetched, Fetcher, FetcherOptions, FetchRecord, GetOptions } from "./fetcher.ts";
