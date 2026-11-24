// End-to-end tests: run the real CLI as a child process against a store on a local server.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { html, item, offer, product, tsv, type Row } from "./helpers.ts";
import { endless, redirect, silent, startStore, type Store } from "./server.ts";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

function run(args: string[], stdin = ""): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--conditions=websync-source", CLI, ...args]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin);
  });
}

const page = (rest: Record<string, unknown> = {}) => ({ body: html(product(rest)) });

let store: Store;
let tmp: string;
const at = (path: string) => `${store.base}${path}`;
/** Requests the store received for a path, since `from`. */
const hits = (path: string, from = 0) => store.requests.slice(from).filter((r) => r.url === path).length;

before(async () => {
  store = await startStore({
    "/p/mug": page({ sku: "MUG" }),
    "/p/tee": page({ sku: "TEE", offers: offer({ price: "25.00", availability: "https://schema.org/OutOfStock" }) }),
    "/p/lamp": page({ offers: offer({ price: "129.00" }) }),
    "/p/old-mug": redirect("/p/mug"),
    "/p/mug-alias": redirect("/p/mug", 302),
    "/p/loop-a": redirect("/p/loop-b"),
    "/p/loop-b": redirect("/p/loop-a"),
    "/p/huge": endless,
    "/p/slow": silent,
    "/p/js-only": { body: "<html><body><div id=app></div><script src=/app.js></script></body></html>" },
    "/p/forbidden": { status: 403, body: "Access denied" },
    // Two redirect chains: /p/r0 to /p/r6 then /p/mug, and /q/0 to /q/6 then /p/lamp.
    ...Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`/p/r${i}`, redirect(i === 6 ? "/p/mug" : `/p/r${i + 1}`)])),
    ...Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`/q/${i}`, redirect(i === 6 ? "/p/lamp" : `/q/${i + 1}`)])),
  });
  tmp = mkdtempSync(join(tmpdir(), "feed-page-check-"));
});

after(() => {
  store.close();
  rmSync(tmp, { recursive: true, force: true });
});

const feedOf = (...rows: Row[]) => tsv(rows);
const mug = () => item("MUG", { link: at("/p/mug") });

describe("reports", () => {
  test("a clean feed: exit 0, a summary, and the request count", async () => {
    const r = await run(["-"], feedOf(mug()));
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stderr, "");
    assert.match(r.stdout, /^stdin: google, tsv, 1 item$/m);
    assert.match(r.stdout, /^1 item matches its page\.$/m);
    assert.match(r.stdout, /^0 errors, 0 warnings\. 1 of 1 item compared with their pages\. 1 request\.$/m);
  });

  test("mismatches: exit 1, each item with both sides and its findings", async () => {
    const feed = feedOf(mug(), item("TEE", { link: at("/p/tee"), price: "25.00 USD", sale_price: "19.00 USD" }), item("LAMP", { link: at("/p/lamp"), price: "120.00 USD", availability: "preorder" }));
    const r = await run(["-"], feed);
    assert.equal(r.code, 1, r.stderr);
    assert.match(r.stdout, /^TEE \(row 3\)$/m);
    assert.match(r.stdout, new RegExp(`^ {2}link {2}${at("/p/tee")} \\(HTTP 200\\)$`, "m"));
    assert.match(r.stdout, /^ {2}feed {2}price 25\.00 USD, sale_price 19\.00 USD \(current\), availability in_stock$/m);
    assert.match(r.stdout, /^ {2}page {2}price 25\.00 USD, availability OutOfStock; line \d+, matched: single$/m);
    assert.match(r.stdout, /^ {2}ERROR {2}sale-price-not-on-page \(page line \d+\)$/m);
    assert.match(r.stdout, /^ {2}ERROR {2}availability-mismatch \(page line \d+\)$/m);
    assert.match(r.stdout, /^ {2}ERROR {2}price-mismatch \(page line \d+\)$/m);
    assert.match(r.stdout, /^ {2}ERROR {2}availability-mismatch/m);
    assert.match(r.stdout, /^1 item matches its page\.$/m);
    assert.match(r.stdout, /^4 errors, 0 warnings\. 3 of 3 items compared with their pages\. 3 requests\.$/m);
  });

  test("--json: the report shape", async () => {
    const r = await run(["-", "--json"], feedOf(mug(), item("TEE", { link: at("/p/tee"), price: "25.00 USD" })));
    assert.equal(r.code, 1);
    const report = JSON.parse(r.stdout);
    assert.deepEqual(Object.keys(report), ["source", "target", "format", "checkedAt", "itemCount", "selectedCount", "checkedCount", "errorCount", "warningCount", "requestCount", "items", "feedFindings"]);
    assert.deepEqual([report.source, report.target, report.format, report.itemCount, report.checkedCount, report.errorCount], ["stdin", "google", "tsv", 2, 2, 1]);
    assert.match(report.checkedAt, /^\d{4}-\d{2}-\d{2}T/);
    const [first, second] = report.items;
    assert.deepEqual(Object.keys(first), ["id", "line", "link", "feed", "page", "findings", "fetch"]);
    assert.deepEqual(first.findings, []);
    assert.deepEqual(Object.keys(first.fetch), ["url", "finalUrl", "status", "redirects", "durationMs", "bytes", "error"]);
    assert.deepEqual([first.fetch.status, first.fetch.error, first.page.matchedBy], [200, null, "single"]);
    assert.deepEqual(second.findings.map((f: { rule: string }) => f.rule), ["availability-mismatch"]);
    assert.deepEqual(Object.keys(second.findings[0]), ["rule", "severity", "message", "line"]);
  });

  test("--max-warnings turns warnings into exit 1", async () => {
    const feed = feedOf(item("JS", { link: at("/p/js-only") }), mug());
    assert.equal((await run(["-"], feed)).code, 0);
    const r = await run(["-", "--max-warnings", "0"], feed);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /^ {2}WARN {3}page-no-product$/m);
  });

  test("reads a feed file and an OpenAI feed", async () => {
    const path = join(tmp, "feed.jsonl");
    writeFileSync(path, JSON.stringify({ item_id: "MUG", url: at("/p/mug"), price: "18.00 USD", availability: "in_stock" }) + "\n");
    const r = await run([path, "--target", "openai"]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /: openai, jsonl, 1 item$/m);
  });

  test("reads the feed from a URL", async () => {
    store.routes["/feed.tsv"] = { headers: { "content-type": "text/tab-separated-values" }, body: feedOf(mug()) };
    const r = await run([at("/feed.tsv")]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`^${at("/feed.tsv")} \\(HTTP 200\\): google, tsv, 1 item$`, "m"));
  });
});

describe("fetching", () => {
  test("follows redirects and names where they ended", async () => {
    const r = await run(["-", "--json"], feedOf(item("MUG", { link: at("/p/old-mug") })));
    assert.equal(r.code, 0, r.stderr);
    const { items } = JSON.parse(r.stdout);
    assert.deepEqual([items[0].fetch.redirects, items[0].fetch.finalUrl, items[0].page.url], [1, at("/p/mug"), at("/p/mug")]);
  });

  test("never requests the same URL twice: shared links and redirects to one page", async () => {
    const from = store.requests.length;
    const feed = feedOf(mug(), item("MUG", { link: at("/p/mug") }), item("MUG", { link: at("/p/old-mug") }), item("MUG", { link: at("/p/mug-alias") }), item("MUG", { link: `${at("/p/mug")}#reviews` }));
    const r = await run(["-", "--json"], feed);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(hits("/p/mug", from), 1);
    assert.equal(JSON.parse(r.stdout).requestCount, 3);
  });

  test("redirect loops and too many redirects are fetch failures, not mismatches", async () => {
    const r = await run(["-", "--json"], feedOf(mug(), item("A", { link: at("/p/loop-a") }), item("B", { link: at("/p/r0") })));
    assert.equal(r.code, 0, r.stderr);
    const [, loop, chain] = JSON.parse(r.stdout).items;
    assert.equal(loop.findings[0].rule, "page-unavailable");
    assert.match(loop.fetch.error, /redirects in a loop/);
    assert.match(chain.fetch.error, /^still redirecting after 5 redirects$/);
    assert.equal(chain.findings[0].severity, "warning");
  });

  test("a page over the byte cap stops being read", async () => {
    const r = await run(["-", "--json"], feedOf(mug(), item("C", { link: at("/p/huge") })));
    assert.equal(r.code, 0, r.stderr);
    const huge = JSON.parse(r.stdout).items[1];
    assert.equal(huge.fetch.error, "the page is larger than 10 MiB, so feed-page-check stopped reading it");
    assert.deepEqual([huge.fetch.status, huge.fetch.bytes, huge.findings[0].rule], [200, null, "page-unavailable"]);
  });

  test("a status other than 2xx and a timeout are fetch failures", async () => {
    const r = await run(["-", "--json", "--timeout", "300"], feedOf(mug(), item("A", { link: at("/p/forbidden") }), item("B", { link: at("/p/slow") }), item("C", { link: at("/p/gone") })));
    assert.equal(r.code, 0, r.stderr);
    const [, forbidden, slow, gone] = JSON.parse(r.stdout).items;
    assert.deepEqual([forbidden.fetch.status, forbidden.fetch.error, forbidden.findings[0].severity], [403, "HTTP 403", "warning"]);
    assert.match(forbidden.findings[0].message, /^The page couldn't be fetched \(HTTP 403\), so it wasn't compared\. Bot protection, rate limits/);
    assert.equal(slow.fetch.error, "timed out after 300 ms");
    assert.match(slow.findings[0].message, /Bot protection/);
    assert.match(gone.findings[0].message, /\(HTTP 404\), so it wasn't compared\. Check that the link is the product's current URL\.$/);
  });

  test("the request budget: 3 per item, redirects included", async () => {
    // Three items, a budget of 9: the mug takes 1, the first chain 6 (r0 to r5, then too many
    // redirects), and the second chain gets the last 2.
    const from = store.requests.length;
    const r = await run(["-", "--json", "--concurrency", "1"], feedOf(mug(), item("B", { link: at("/p/r0") }), item("C", { link: at("/q/0") })));
    assert.equal(r.code, 0, r.stderr);
    const report = JSON.parse(r.stdout);
    assert.equal(report.requestCount, 9);
    assert.equal(store.requests.length - from, 9);
    assert.deepEqual([report.items[2].fetch.redirects, report.items[2].fetch.error], [2, "not requested: the run's limit of 9 requests was reached"]);
  });

  test("--limit checks the first n items only", async () => {
    const from = store.requests.length;
    const r = await run(["-", "--limit", "1"], feedOf(mug(), item("TEE", { link: at("/p/tee") })));
    assert.equal(r.code, 0);
    assert.equal(hits("/p/tee", from), 0);
    assert.match(r.stdout, /1 of 2 items compared with their pages \(the first 1; raise --limit for more\)\./);
  });

  test("--concurrency bounds the requests in flight", async () => {
    const own = await startStore(Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`/c/${i}`, page()])));
    try {
      const rows = Array.from({ length: 12 }, (_, i) => item(`C${i}`, { link: `${own.base}/c/${i}` }));
      const r = await run(["-", "--concurrency", "2"], feedOf(...rows));
      assert.equal(r.code, 0, r.stderr);
      assert.equal(own.requests.length, 12);
      assert.equal(own.maxOpen, 2);
    } finally {
      own.close();
    }
  });

  test("links that can't be fetched are reported, not requested", async () => {
    const r = await run(["-", "--json"], feedOf(mug(), item("A", { link: "ftp://shop.example/a" }), item("B", { link: "" })));
    const [, ftp, none] = JSON.parse(r.stdout).items;
    assert.deepEqual([ftp.findings[0].rule, ftp.fetch, none.findings[0].rule], ["link-unusable", null, "link-unusable"]);
    assert.match(none.findings[0].message, /The item has no link/);
    assert.equal(ftp.feed.price, "18.00 USD");
  });

  test("sends a User-Agent naming the package and its version", async () => {
    const from = store.requests.length;
    await run(["-"], feedOf(mug()));
    assert.match(String(store.requests[from].headers["user-agent"]), /^feed-page-check\/\d+\.\d+\.\d+ \(\+https:\/\/github\.com\/idrisiRehan\/websync-plugins\)$/);
  });
});

describe("exit code 2", () => {
  test("usage errors fetch nothing", async () => {
    const from = store.requests.length;
    for (const args of [[], ["a", "b"], ["-", "--target", "bing"], ["-", "--format", "jsonl"], ["-", "--limit", "0"], ["-", "--concurrency", "17"], ["-", "--timeout", "x"], ["-", "--nope"]]) {
      const r = await run(args, feedOf(mug()));
      assert.equal(r.code, 2, args.join(" "));
      assert.match(r.stderr, /^feed-page-check: .+ Run "feed-page-check --help" for usage\.\n$/, args.join(" "));
      assert.equal(r.stdout, "");
    }
    assert.equal(store.requests.length, from);
  });

  test("an unreadable or empty feed, or a missing file", async () => {
    let r = await run(["-"], "");
    assert.deepEqual([r.code, r.stderr], [2, "feed-page-check: stdin: The feed is empty. Run product-feed-lint on it for details.\n"]);
    r = await run(["-"], "<rss><channel><item>");
    assert.equal(r.code, 2);
    assert.match(r.stderr, /The XML isn't well-formed/);
    r = await run([join(tmp, "missing.tsv")]);
    assert.deepEqual([r.code, r.stderr], [2, "feed-page-check: File not found.\n"]);
  });

  test("no page could be fetched, or there was none to fetch", async () => {
    let r = await run(["-"], feedOf(item("A", { link: at("/p/forbidden") })));
    assert.deepEqual([r.code, r.stdout], [2, ""]);
    assert.equal(r.stderr, `feed-page-check: The page ${at("/p/forbidden")} couldn't be fetched: HTTP 403.\n`);
    r = await run(["-"], feedOf(item("A", { link: at("/p/forbidden") }), item("B", { link: at("/p/gone") })));
    assert.equal(r.stderr, `feed-page-check: None of the 2 pages could be fetched. The first, ${at("/p/forbidden")}, failed: HTTP 403.\n`);
    r = await run(["-"], feedOf(item("A", { link: "/relative" })));
    assert.deepEqual([r.code, r.stderr], [2, "feed-page-check: No item has an http or https link to fetch.\n"]);
  });

  test("--help and --version exit 0", async () => {
    const help = await run(["--help"]);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /^Usage:/);
    const version = await run(["-v"]);
    assert.match(version.stdout, /^\d+\.\d+\.\d+\n$/);
  });
});
