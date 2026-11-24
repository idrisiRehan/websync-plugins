// What a crawler may fetch: isAllowed() for one URL, aiCrawlerReport() for the AI crawler table.
// Both take robots.txt text or a lintRobotsTxt() result and match with RFC 9309 (match.ts).

import { AI_CRAWLERS, type AiCrawler } from "./ai-crawlers.ts";
import { lintRobotsTxt, type RobotsGroup, type RobotsTxtResult } from "./lint.ts";
import { decide, matchesEverything, normalize, PRODUCT_TOKEN, selectGroups, type AccessDecision } from "./match.ts";

export type RobotsInput = string | Pick<RobotsTxtResult, "groups">;

export interface AiCrawlerAccess extends AiCrawler {
  /**
   * allowed: no Disallow rule applies. blocked: a rule disallows every path and no Allow rule
   * applies. partial: anything in between.
   */
  access: "allowed" | "blocked" | "partial";
  /** "specific" when a group names the token, "*" when the * group applied, null when no group did. */
  group: AccessDecision["group"];
  /** 1-based line of each group that applied. */
  groupLines: number[];
}

function groupsOf(robots: RobotsInput): readonly RobotsGroup[] {
  if (typeof robots === "string") return lintRobotsTxt(robots).groups;
  if (!robots || !Array.isArray(robots.groups)) throw new TypeError("robots must be robots.txt text or a lintRobotsTxt() result.");
  return robots.groups;
}

/**
 * The path and query crawlers match against, from an absolute URL or a path. A path is parsed as a
 * URL on a placeholder host, so both forms are percent-encoded the same way ("/a b" and
 * "https://example.com/a b" are both "/a%20b"), as a crawler would request them.
 */
function requestPath(urlOrPath: string): string {
  let url: URL | null = null;
  try {
    url = new URL(typeof urlOrPath === "string" && urlOrPath.startsWith("/") ? `http://host${urlOrPath}` : urlOrPath);
  } catch {
    // Reported below.
  }
  if (!url || !url.pathname.startsWith("/")) throw new TypeError(`urlOrPath must be an absolute URL or a path starting with "/", got "${urlOrPath}".`);
  return url.pathname + url.search;
}

/**
 * Whether the crawler with this product token may fetch the URL, and the rule that decided.
 * Use "*" for a crawler that has no group of its own.
 */
export function isAllowed(robots: RobotsInput, userAgent: string, urlOrPath: string): AccessDecision {
  if (typeof userAgent !== "string" || (userAgent !== "*" && !PRODUCT_TOKEN.test(userAgent))) {
    throw new TypeError(`userAgent must be "*" or a product token of letters, "-" and "_" (such as "Googlebot"), got "${userAgent}".`);
  }
  const path = normalize(requestPath(urlOrPath), false);
  return decide(groupsOf(robots), userAgent, path);
}

/** For each crawler in AI_CRAWLERS, whether robots.txt lets it crawl the site. */
export function aiCrawlerReport(robots: RobotsInput): AiCrawlerAccess[] {
  const groups = groupsOf(robots);
  return AI_CRAWLERS.map((crawler) => {
    const selection = selectGroups(groups, crawler.token);
    const rules = selection.groups.flatMap((g) => g.rules).filter((r) => r.pattern);
    const disallows = rules.filter((r) => r.type === "disallow");
    let access: AiCrawlerAccess["access"] = "partial";
    if (!disallows.length) access = "allowed";
    else if (rules.length === disallows.length && disallows.some((r) => matchesEverything(normalize(r.pattern, true)))) access = "blocked";
    return { ...crawler, access, group: selection.group, groupLines: selection.groups.map((g) => g.line) };
  });
}
