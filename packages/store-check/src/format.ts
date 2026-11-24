// The text report: one block per section (status, facts, the first few findings), then what was
// fetched and a closing summary line. The JSON report has every finding.

import type { Finding, SectionStatus, StoreReport } from "./check.ts";

const LABELS: Record<SectionStatus, string> = { pass: "PASS", warnings: "WARNINGS", errors: "ERRORS", skipped: "SKIPPED", unavailable: "UNAVAILABLE" };
const LABEL_WIDTH = 13;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function findingLines(f: Finding, showUrl: boolean): string[] {
  const where = [showUrl ? f.url : "", f.where ?? ""].filter(Boolean).join(", ");
  return [`  ${f.severity === "error" ? "ERROR" : "WARN "}  ${f.rule}${where ? ` (${where})` : ""}`, `         ${f.message}`];
}

/** The report as text. Each section shows at most `maxFindings` findings, errors first. */
export function formatReport(report: StoreReport, maxFindings = 3): string {
  const lines = [`store-check ${report.url}, ${report.checkedAt.slice(0, 16).replace("T", " ")} UTC`, ""];
  for (const s of report.sections) {
    const counts = s.findings.length ? ` (${plural(s.errorCount, "error")}, ${plural(s.warningCount, "warning")})` : "";
    lines.push(`${LABELS[s.status].padEnd(LABEL_WIDTH)}${s.title}${counts}`);
    for (const fact of s.facts) lines.push(`  ${fact}`);
    const ordered = [...s.findings.filter((f) => f.severity === "error"), ...s.findings.filter((f) => f.severity === "warning")];
    // A section can hold findings about two files (a sitemap index and its child), so name the file then.
    const showUrl = new Set(ordered.map((f) => f.url)).size > 1;
    for (const f of ordered.slice(0, maxFindings)) lines.push(...findingLines(f, showUrl));
    if (ordered.length > maxFindings) lines.push(`  ... and ${ordered.length - maxFindings} more (--json lists every finding)`);
    lines.push("");
  }

  lines.push("Fetched:");
  for (const r of report.requests) {
    const redirects = r.redirects ? ` -> ${r.finalUrl} (${plural(r.redirects, "redirect")})` : "";
    lines.push(`  ${String(r.status ?? "---").padEnd(3)}  ${String(r.durationMs).padStart(5)} ms  ${r.purpose}: ${r.url}${redirects}${r.error ? `, ${r.error}` : ""}`);
  }

  const count = (status: SectionStatus) => report.sections.filter((s) => s.status === status).length;
  const statuses = [
    [count("errors"), "with errors"],
    [count("warnings"), "with warnings"],
    [count("pass"), "passed"],
    [count("skipped"), "skipped"],
    [count("unavailable"), "unavailable"],
  ] as const;
  const breakdown = statuses.filter(([n]) => n).map(([n, label]) => `${n} ${label}`).join(", ");
  lines.push(
    "",
    `${plural(report.errorCount, "error")}, ${plural(report.warningCount, "warning")}. ${plural(report.sections.length, "section")}: ${breakdown}. ${plural(report.requestCount, "request")}.`,
  );
  return lines.join("\n");
}
