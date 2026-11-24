// End-to-end tests: run the real CLI as a child process against local stores.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import type { StoreReport } from "../src/index.ts";
import { healthyStore, homePage, startStore, text, type Store } from "./store.ts";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

function run(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--conditions=websync-source", CLI, ...args]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

let healthy: Store;
let blocked: Store;

before(async () => {
  // Each store needs its own origin before its routes can name it, so start, then fill in.
  healthy = await startStore({});
  Object.assign(healthy.routes, healthyStore(healthy.base));
  // Blocks every crawler and sends no security headers.
  blocked = await startStore({});
  Object.assign(blocked.routes, healthyStore(blocked.base), {
    "/robots.txt": text(`User-agent: *\nDisallow: /\n\nSitemap: ${blocked.base}/sitemap.xml\n`),
    "/": { headers: { "content-type": "text/html" }, body: homePage(blocked.base) },
  });
});

after(() => {
  healthy.close();
  blocked.close();
});

describe("text output", () => {
  test("shows each section with its status and facts, what was fetched, and a summary", async () => {
    const r = await run([healthy.base]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stderr, "");
    assert.match(r.stdout, new RegExp(`^store-check ${healthy.base}/, \\d{4}-\\d{2}-\\d{2} \\d{2}:\\d{2} UTC$`, "m"));
    // Plain http never reaches https, which redirect-inspector reports as a warning.
    assert.match(r.stdout, /^WARNINGS {5}Redirects and HTTPS \(0 errors, 1 warning\)$/m);
    assert.match(r.stdout, /^ {2}WARN {3}https-missing$/m);
    for (const title of ["robots.txt", "Crawler access", "Sitemap", "llms.txt", "Home page metadata", "Product page metadata", "Structured data", "Security headers"]) {
      assert.match(r.stdout, new RegExp(`^PASS {9}${title.replace(".", "\\.")}$`, "m"));
    }
    assert.match(r.stdout, /Product rich result: Product snippet and Merchant listing valid\./);
    assert.match(r.stdout, /^Fetched:$/m);
    assert.match(r.stdout, new RegExp(`^ {2}200 +\\d+ ms {2}product page: ${healthy.base}/products/wool-runner$`, "m"));
    assert.match(r.stdout, /^0 errors, 1 warning\. 9 sections: 1 with warnings, 8 passed\. 7 requests\.$/m);
  });

  test("shows errors first with their rule ids, at most three per section", async () => {
    const r = await run([blocked.base]);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /^ERRORS {7}Crawler access \(2 errors, 0 warnings\)$/m);
    assert.match(r.stdout, /No listed AI crawler may fetch the home page and the product page\./);
    // The two findings are about different pages, so each names its URL.
    assert.match(r.stdout, new RegExp(`^ {2}ERROR {2}googlebot-blocked \\(${blocked.base}/products/wool-runner\\)$`, "m"));
    const headers = r.stdout.slice(r.stdout.indexOf("Security headers ("));
    assert.match(headers, /^Security headers \(3 errors, 3 warnings\)$/m);
    assert.deepEqual([...headers.matchAll(/^ {2}(?:ERROR|WARN ) {2}(\S+)$/gm)].map((m) => m[1]), ["hsts-missing", "csp-missing", "clickjack-missing"]);
    assert.match(headers, /^ {2}\.\.\. and 3 more \(--json lists every finding\)$/m);
  });

  test("sends a User-Agent with the package version", async () => {
    const before = healthy.requests.length;
    await run([healthy.base]);
    const ua = healthy.requests[before].headers["user-agent"];
    assert.match(String(ua), /^store-check\/\d+\.\d+\.\d+ \(\+https:\/\/github\.com\/idrisiRehan\/websync-plugins\)$/);
  });
});

describe("--json", () => {
  test("prints the whole report", async () => {
    const r = await run([healthy.base, "--json"]);
    assert.equal(r.code, 0, r.stderr);
    const report = JSON.parse(r.stdout) as StoreReport;
    assert.equal(report.reachable, true);
    assert.equal(report.sections.length, 9);
    assert.equal(report.requestCount, 7);
    assert.equal(report.product?.source, "sitemap");
    assert.equal(report.crawlers?.ai.length, 21);
  });

  test("--product checks the given page", async () => {
    const r = await run([healthy.base, "--json", "--product", `${healthy.base}/products/wool-runner?variant=2`]);
    const report = JSON.parse(r.stdout) as StoreReport;
    assert.deepEqual(report.product, { url: `${healthy.base}/products/wool-runner?variant=2`, source: "option" });
  });
});

describe("exit codes", () => {
  test("1 when a section has errors", async () => {
    const r = await run([blocked.base, "--json"]);
    assert.equal(r.code, 1);
    assert.ok((JSON.parse(r.stdout) as StoreReport).errorCount > 0);
  });

  test("1 when there are more warnings than --max-warnings", async () => {
    assert.equal((await run([healthy.base, "--max-warnings", "0"])).code, 1);
    assert.equal((await run([healthy.base, "--max-warnings", "1"])).code, 0);
  });

  test("2 with a one-line error when the site can't be reached", async () => {
    const gone = await startStore({});
    const base = gone.base;
    gone.close();
    const r = await run([base, "--timeout", "2000"]);
    assert.equal(r.code, 2);
    assert.equal(r.stdout, "");
    assert.match(r.stderr, /^store-check: The site could not be reached\. Request to http:\/\/127\.0\.0\.1:\d+\/ failed: .+\n$/);
  });

  test("2 for usage errors, before anything is fetched", async () => {
    const before = healthy.requests.length;
    for (const args of [[], [healthy.base, "extra"], [healthy.base, "--timeout", "0"], [healthy.base, "--max-warnings", "-1"], ["ftp://shop.test"], [healthy.base, "--product", "https://elsewhere.test/products/x"], [healthy.base, "--nope"]]) {
      const r = await run(args);
      assert.equal(r.code, 2, args.join(" "));
      assert.equal(r.stdout, "");
      assert.match(r.stderr, /^store-check: .+ Run "store-check --help" for usage\.\n$/, args.join(" "));
    }
    assert.equal(healthy.requests.length, before);
  });

  test("--product on another host names the option", async () => {
    const r = await run([healthy.base, "--product", "https://elsewhere.test/products/x"]);
    assert.match(r.stderr, /--product must be on the store's host/);
  });

  test("--help and --version exit 0", async () => {
    const help = await run(["--help"]);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /^Usage:\n {2}store-check <url> \[options\]/);
    const version = await run(["--version"]);
    assert.equal(version.code, 0);
    assert.match(version.stdout, /^\d+\.\d+\.\d+\n$/);
  });
});
