// The CLI's only network code: fetches the operators' IP lists named in the crawler table, and
// reads and writes the offline file made with --dump-ranges. One GET per list URL through
// redirect-inspector's fetcher: a timeout on each request, at most 5 redirects, bodies read up
// to a byte cap while they stream, failed responses' bodies cancelled.

import { createFetcher, type Fetcher } from "redirect-inspector";
import { RANGE_URLS } from "./crawlers.ts";
import { IpRangeSet, parseRangeFile } from "./ip.ts";

/** The largest list today is about 150 KB (Amazon's HTML page); the cap only stops a runaway response. */
export const MAX_LIST_BYTES = 4 * 1024 * 1024;

export interface RangeList {
  url: string;
  /** Prefixes as listed; empty when loading failed. */
  prefixes: string[];
  /** The list's own `creationTime`, when it has one. */
  creationTime: string | null;
  /** Why the list couldn't be loaded, or null. */
  error: string | null;
}

export interface FetchListsOptions {
  fetch?: typeof fetch;
  timeoutMs: number;
  userAgent: string;
}

const hasRange = (prefixes: readonly string[]) => new IpRangeSet(prefixes).size > 0;

async function fetchList(net: Fetcher, url: string): Promise<RangeList> {
  const failed = (error: string): RangeList => ({ url, prefixes: [], creationTime: null, error });
  const { record, body } = await net.get(url, {
    accept: "application/json, text/html;q=0.5",
    maxBytes: MAX_LIST_BYTES,
    tooLargeError: `larger than ${MAX_LIST_BYTES / (1024 * 1024)} MiB`,
  });
  if (record.error) return failed(record.error);
  if (!body) return failed(`HTTP ${record.status}`);
  const { creationTime, prefixes } = parseRangeFile(Buffer.from(body).toString("utf8"));
  // A list with no usable range would make every request of its crawlers look spoofed.
  if (!hasRange(prefixes)) return failed("no IP prefixes found in the response");
  return { url, prefixes, creationTime, error: null };
}

/** Fetches every list in the crawler table, in parallel. Never throws; failures carry an error. */
export function fetchLists(options: FetchListsOptions): Promise<RangeList[]> {
  const net = createFetcher(options);
  return Promise.all(RANGE_URLS.map((url) => fetchList(net, url)));
}

/** The --dump-ranges file: the lists that loaded, keyed by URL. */
export function dumpLists(lists: readonly RangeList[], now = new Date()): string {
  const out: Record<string, { creationTime: string | null; prefixes: string[] }> = {};
  for (const list of lists) if (!list.error) out[list.url] = { creationTime: list.creationTime, prefixes: list.prefixes };
  return JSON.stringify({ fetched: now.toISOString(), lists: out }, null, 2);
}

/**
 * Reads a file made with --dump-ranges: one entry per list in the crawler table, failed when the
 * file doesn't hold it. Lists for URLs that aren't in the table are ignored, since no crawler would
 * use them. Throws an Error with a readable message on a bad file.
 */
export function readLists(text: string): RangeList[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error(`The ranges file is not valid JSON: ${(error as Error).message}`);
  }
  const lists = (data as { lists?: unknown } | null)?.lists;
  if (lists === null || typeof lists !== "object" || Array.isArray(lists)) {
    throw new Error(`The ranges file has no "lists" object. Make one with "ai-crawler-log --dump-ranges".`);
  }
  const out: RangeList[] = [];
  for (const url of RANGE_URLS) {
    const entry = (lists as Record<string, unknown>)[url] as { creationTime?: unknown; prefixes?: unknown } | undefined;
    if (entry === undefined) {
      out.push({ url, prefixes: [], creationTime: null, error: "not in the ranges file" });
      continue;
    }
    if (!Array.isArray(entry?.prefixes) || !entry.prefixes.every((p) => typeof p === "string") || !hasRange(entry.prefixes)) {
      throw new Error(`The ranges file's entry for ${url} needs a "prefixes" array of strings with at least one IP range.`);
    }
    out.push({ url, prefixes: entry.prefixes, creationTime: typeof entry.creationTime === "string" ? entry.creationTime : null, error: null });
  }
  return out;
}
