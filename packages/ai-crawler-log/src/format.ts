// The CLI's text report. Everything it shows is in the JSON output too.

import type { CrawlerStats, LogReport, PathCount } from "./analyze.ts";
import type { RangeList } from "./ranges.ts";

export interface TextOptions {
  /** File names, "stdin" for -. */
  sources: string[];
  /** Where the IP lists came from: fetched, a --ranges file, or not loaded (--no-verify). */
  lists: { from: "fetched" | "file" | "off"; file?: string; loaded: RangeList[]; failed: RangeList[] };
  highlights: string[];
  top: number;
}

const num = (n: number) => n.toLocaleString("en-US");

function table(rows: string[][]): string[] {
  const widths = rows[0].map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  // The first two columns are names; the rest are numbers, aligned right.
  return rows.map((r) => r.map((cell, i) => (i < 2 ? cell.padEnd(widths[i]) : cell.padStart(widths[i]))).join("  ").trimEnd());
}

function crawlerRows(heading: string, crawlers: CrawlerStats[]): string[] {
  const check = (c: CrawlerStats, n: number) => (c.verification === "checked" ? num(n) : c.verification === "unverifiable" ? "n/a" : "-");
  return table([
    [heading, "Operator", "Requests", "Verified", "Spoofed", "Products", "4xx", "5xx"],
    ...crawlers.map((c) => [c.token, c.operator, num(c.requests), check(c, c.verified), check(c, c.spoofed), num(c.productPages), num(c.status["4xx"]), num(c.status["5xx"])]),
  ]);
}

const minute = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)}`;
const count = (p: PathCount) => `${p.overcount ? "~" : ""}${num(p.requests)}`;

function listsLine(lists: TextOptions["lists"]): string {
  if (lists.from === "off") return "IP lists: not loaded (--no-verify), so no request is verified or counted as spoofed.";
  const total = lists.loaded.length + lists.failed.length;
  const where = lists.from === "fetched" ? "fetched from the operators" : `read from ${lists.file}`;
  const failed = lists.failed.map((l) => `${l.url} (${l.error})`);
  return `IP lists: ${lists.loaded.length} of ${total} ${where}.${failed.length ? ` Not loaded: ${failed.join(", ")}.` : ""}`;
}

export function formatReport(report: LogReport, options: TextOptions): string {
  const { sources } = options;
  const label = sources.length <= 3 ? sources.join(", ") : `${sources.length} files`;
  const span = report.firstSeen && report.lastSeen ? `, ${minute(report.firstSeen)} to ${minute(report.lastSeen)} UTC` : "";
  const lines = [`${label}: ${num(report.lines)} lines, ${num(report.unparsed)} unreadable${span}`, listsLine(options.lists), ""];

  const seen = report.crawlers.filter((c) => c.requests > 0);
  const ai = seen.filter((c) => c.kind === "ai");
  const search = seen.filter((c) => c.kind === "search");
  if (ai.length) lines.push(...crawlerRows("AI crawler", ai), "");
  if (search.length) lines.push(...crawlerRows("Search engine", search), "");
  lines.push(`Other requests: ${num(report.other.requests)}`);
  const unseen = report.crawlers.filter((c) => c.requests === 0).map((c) => c.token);
  if (unseen.length) lines.push(`Not seen: ${unseen.join(", ")}`);
  if (seen.some((c) => c.verification !== "checked")) lines.push(`n/a: the operator publishes no IP list. -: its IP list wasn't loaded.`);

  if (options.highlights.length) lines.push("", "Highlights:", ...options.highlights.map((h) => `  - ${h}`));

  const withPaths = seen.filter((c) => c.topPaths.length);
  if (withPaths.length) {
    lines.push("", `Top paths (up to ${options.top} per crawler, spoofed requests left out; ~ marks an estimate):`);
    for (const c of withPaths) {
      const top = c.topPaths.slice(0, options.top);
      const width = Math.max(...top.map((p) => count(p).length));
      lines.push(`  ${c.token}`, ...top.map((p) => `    ${count(p).padStart(width)}  ${p.path}`));
    }
  }

  const spoofers = seen.filter((c) => c.spoofedNetworks?.length);
  if (spoofers.length) {
    lines.push("", "Networks sending spoofed requests (/24 or /48):");
    for (const c of spoofers) {
      lines.push(`  ${c.token}: ${c.spoofedNetworks!.slice(0, options.top).map((n) => `${n.network} (${n.overcount ? "~" : ""}${num(n.requests)})`).join(", ")}`);
    }
  }
  return lines.join("\n");
}
