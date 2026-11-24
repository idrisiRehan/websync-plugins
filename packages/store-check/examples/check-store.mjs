// Checks a store with the library and prints one line per section, then fails (exit code 1)
// when any section has errors. Run with: node examples/check-store.mjs https://yourstore.com
import { checkStore } from "store-check";

const report = await checkStore(process.argv[2] ?? "https://example.com", { timeoutMs: 15_000 });

if (!report.reachable) {
  console.error(`Could not reach ${report.url}: ${report.requests[0].error}`);
  process.exit(2);
}

for (const section of report.sections) {
  console.log(`${section.status.padEnd(12)} ${section.title}: ${section.facts[0] ?? ""}`);
}

const rich = report.sections.find((s) => s.id === "structured-data")?.facts.find((f) => f.startsWith("Product rich result"));
console.log(`\n${rich ?? "No product page was checked."}`);
console.log(`GPTBot may fetch the product page: ${report.crawlers?.ai.find((c) => c.token === "GPTBot")?.product ?? "unknown"}`);

process.exitCode = report.errorCount > 0 ? 1 : 0;
