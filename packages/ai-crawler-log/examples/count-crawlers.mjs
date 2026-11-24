// Counts AI crawler requests in a log with the library: offline, without IP checks.
// Run with: node examples/count-crawlers.mjs examples/synthetic-access.log
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { createLogAnalyzer } from "ai-crawler-log";

const analyzer = createLogAnalyzer();
for await (const line of createInterface({ input: createReadStream(process.argv[2] ?? "examples/synthetic-access.log") })) {
  analyzer.add(line);
}

for (const c of analyzer.result().crawlers.filter((c) => c.kind === "ai" && c.requests > 0)) {
  console.log(`${c.token.padEnd(20)} ${String(c.requests).padStart(5)} requests, ${c.productPages} product pages, ${c.llmsTxt} llms.txt`);
}
