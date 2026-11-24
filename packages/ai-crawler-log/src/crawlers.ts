// Which crawler a request's User-Agent names. The AI crawlers come from robots-txt-lint's table,
// the single source for tokens, user agents and IP lists; the search engines below are a baseline
// to compare AI traffic with.

import { AI_CRAWLERS, type AiCrawlerPurpose } from "robots-txt-lint";

export interface SearchCrawler {
  token: string;
  operator: string;
  /** The page that gives the user agent and links the IP list. */
  source: string;
  /** Date the entry was last compared with `source`. */
  checked: string;
  /** The product name the crawler's User-Agent header carries. */
  userAgent: string;
  /** The list of the crawler's IP addresses that `source` links to. */
  ipRanges: string;
}

/** Search engine crawlers counted as a baseline. Each was checked on its operator's page. */
export const SEARCH_CRAWLERS: readonly SearchCrawler[] = [
  {
    token: "Googlebot",
    operator: "Google",
    source: "https://developers.google.com/crawling/docs/crawlers-fetchers/google-common-crawlers",
    checked: "2026-11-24",
    userAgent: "Googlebot",
    ipRanges: "https://developers.google.com/static/crawling/ipranges/common-crawlers.json",
  },
  {
    token: "Applebot",
    operator: "Apple",
    source: "https://support.apple.com/en-us/119829",
    checked: "2026-11-24",
    userAgent: "Applebot",
    // Apple's page links the http:// URL; the same file is served over https.
    ipRanges: "https://search.developer.apple.com/applebot.json",
  },
];

export interface Crawler {
  token: string;
  operator: string;
  /** "ai" for robots-txt-lint's AI crawlers, "search" for the search engine baseline. */
  kind: "ai" | "search";
  /** The AI crawler's purpose, or null for a search engine. */
  purpose: AiCrawlerPurpose | null;
  userAgent: string;
  ipRanges: string | null;
}

/** Every crawler a log line can be attributed to: AI crawlers first, then search engines. Control tokens that never crawl are left out. */
export const CRAWLERS: readonly Crawler[] = [
  ...AI_CRAWLERS.flatMap(({ token, operator, purpose, userAgent, ipRanges }) => (userAgent ? [{ token, operator, kind: "ai" as const, purpose, userAgent, ipRanges }] : [])),
  ...SEARCH_CRAWLERS.map(({ token, operator, userAgent, ipRanges }) => ({ token, operator, kind: "search" as const, purpose: null, userAgent, ipRanges })),
];

/** Every distinct IP list URL in the table, in table order. */
export const RANGE_URLS: readonly string[] = [...new Set(CRAWLERS.flatMap((c) => (c.ipRanges ? [c.ipRanges] : [])))];

const isNameChar = (code: number) =>
  (code >= 48 && code <= 57) || (code >= 65 && code <= 90) || (code >= 97 && code <= 122) || code === 45 || code === 95;

/** Whether `name` (lowercase) appears in `ua` (lowercase) as a whole product name, not inside a longer one. */
function containsName(ua: string, name: string): boolean {
  for (let at = ua.indexOf(name); at !== -1; at = ua.indexOf(name, at + 1)) {
    const before = at === 0 ? 0 : ua.charCodeAt(at - 1);
    const after = ua.charCodeAt(at + name.length);
    if (!isNameChar(before) && !(after >= 0 && isNameChar(after))) return true;
  }
  return false;
}

const LOWER_NAMES = CRAWLERS.map((c) => c.userAgent.toLowerCase());

/**
 * The crawler a User-Agent header names, or null. Names compare without case and must stand
 * alone: "GPTBot/1.4" matches GPTBot, "NotGPTBot" and "Googlebot-Image" don't match GPTBot or
 * Googlebot. When a header names several, the first in table order wins.
 */
export function matchCrawler(userAgent: string): Crawler | null {
  if (typeof userAgent !== "string" || userAgent === "") return null;
  const ua = userAgent.toLowerCase();
  for (let i = 0; i < CRAWLERS.length; i++) {
    if (containsName(ua, LOWER_NAMES[i])) return CRAWLERS[i];
  }
  return null;
}
