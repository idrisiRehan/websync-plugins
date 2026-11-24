// A few plain-language sentences about a report: what stands out, in the order a site owner would
// act on it (fakes first, then errors, then what the crawlers read).

import type { CrawlerStats, LogReport } from "./analyze.ts";

const num = (n: number) => n.toLocaleString("en-US");
const plural = (n: number, word: string) => `${num(n)} ${word}${n === 1 ? "" : "s"}`;

/** "A", "A and B", "A, B and C", or "A, B, C and 4 others" past `max` items. */
function list(items: string[], max = 4): string {
  const shown = items.length > max ? [...items.slice(0, max - 1), `${items.length - max + 1} others`] : items;
  if (shown.length <= 2) return shown.join(" and ");
  return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}`;
}

const errorsOf = (c: CrawlerStats) => c.status["4xx"] + c.status["5xx"];

/** Sentences about what stands out in the report, most actionable first. */
export function reportHighlights(report: LogReport): string[] {
  const out: string[] = [];
  const ai = report.crawlers.filter((c) => c.kind === "ai" && c.requests > 0);
  const search = report.crawlers.filter((c) => c.kind === "search" && c.requests > 0);
  const aiRequests = ai.reduce((n, c) => n + c.requests, 0);
  const searchRequests = search.reduce((n, c) => n + c.requests, 0);

  if (report.parsed === 0) return out;
  if (!ai.length) {
    out.push(`No request named one of the AI crawlers.`);
  } else {
    const share = ((aiRequests / report.parsed) * 100).toFixed(1);
    out.push(`AI crawlers made ${num(aiRequests)} of ${plural(report.parsed, "request")} (${share}%); the search engines counted here made ${num(searchRequests)}.`);
  }

  for (const c of [...ai, ...search].filter((c) => c.spoofed > 0).sort((a, b) => b.spoofed - a.spoofed)) {
    out.push(`${plural(c.spoofed, "request")} claimed ${c.token} from addresses ${c.operator} doesn't publish.`);
  }

  for (const c of ai.filter((c) => errorsOf(c) > 0).sort((a, b) => errorsOf(b) - errorsOf(a)).slice(0, 3)) {
    const worst = c.topErrors[0];
    const where = worst && worst.requests > 1 ? `, most on ${worst.path} (${worst.overcount ? "about " : ""}${num(worst.requests)})` : "";
    out.push(`${c.token} got ${plural(errorsOf(c), "error response")} (4xx or 5xx)${where}.`);
  }

  const readers = ai.filter((c) => c.productPages > 0).sort((a, b) => b.productPages - a.productPages);
  if (readers.length) out.push(`Product pages fetched: ${list(readers.map((c) => `${c.token} ${num(c.productPages)}`))}.`);
  else if (ai.length) out.push(`No AI crawler fetched a product page.`);

  const llms = ai.filter((c) => c.llmsTxt > 0);
  if (llms.length) out.push(`llms.txt was requested by ${list(llms.map((c) => `${c.token} (${num(c.llmsTxt)})`))}.`);
  else if (ai.length) out.push(`No AI crawler requested /llms.txt or /llms-full.txt.`);

  const unverifiable = ai.filter((c) => c.verification === "unverifiable");
  if (unverifiable.length) {
    const n = unverifiable.reduce((sum, c) => sum + c.requests, 0);
    out.push(`${plural(n, "request")} from ${list(unverifiable.map((c) => c.token))} can't be verified: ${unverifiable.length === 1 ? "its operator publishes" : "their operators publish"} no IP addresses.`);
  }
  const unchecked = [...ai, ...search].filter((c) => c.verification === "unchecked");
  if (unchecked.length) {
    const n = unchecked.reduce((sum, c) => sum + c.requests, 0);
    out.push(`${plural(n, "request")} from ${list(unchecked.map((c) => c.token))} ${n === 1 ? "wasn't" : "weren't"} checked, because the IP lists weren't loaded.`);
  }
  return out;
}
