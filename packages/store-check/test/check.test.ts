import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { gzipSync } from "node:zlib";
import { checkStore, MAX_REQUESTS, type Section, type SectionId, type StoreReport } from "../src/index.ts";
import {
  endless,
  gzipped,
  healthyStore,
  html,
  ldScript,
  page,
  productPage,
  silent,
  startStore,
  storeFetch,
  text,
  urlset,
  xml,
  type Routes,
  type Store,
} from "./store.ts";

const ORIGIN = "https://shop.test";
const stores: Store[] = [];
after(() => stores.forEach((s) => s.close()));

/** Checks https://shop.test served from the given routes (the healthy store with overrides). */
async function check(overrides: Routes = {}, options: Parameters<typeof storeFetch>[1] & { productUrl?: string; timeoutMs?: number } = {}): Promise<{ report: StoreReport; store: Store }> {
  const store = await startStore({ ...healthyStore(ORIGIN), ...overrides });
  stores.push(store);
  const report = await checkStore(ORIGIN, { fetch: storeFetch(store, options), productUrl: options.productUrl, timeoutMs: options.timeoutMs });
  return { report, store };
}

const get = (report: StoreReport, id: SectionId): Section => report.sections.find((s) => s.id === id)!;
const rules = (s: Section) => s.findings.map((f) => f.rule);
const facts = (s: Section) => s.facts.join("\n");
const purposes = (report: StoreReport) => report.requests.map((r) => r.purpose);

describe("a healthy store", () => {
  test("passes every section with no findings", async () => {
    const { report } = await check();
    assert.equal(report.reachable, true);
    assert.equal(report.url, `${ORIGIN}/`);
    assert.equal(report.site, ORIGIN);
    assert.deepEqual(
      report.sections.map((s) => [s.id, s.status]),
      [
        ["redirects", "pass"],
        ["robots-txt", "pass"],
        ["crawlers", "pass"],
        ["sitemap", "pass"],
        ["llms-txt", "pass"],
        ["home-page", "pass"],
        ["product-page", "pass"],
        ["structured-data", "pass"],
        ["security-headers", "pass"],
      ],
    );
    assert.equal(report.errorCount, 0);
    assert.equal(report.warningCount, 0);
    assert.match(report.checkedAt, /^\d{4}-\d{2}-\d{2}T/);
  });

  test("picks the product page from the product sitemap of the index, and reads only that child", async () => {
    const { report, store } = await check();
    assert.deepEqual(report.product, { url: `${ORIGIN}/products/wool-runner`, source: "sitemap" });
    const paths = store.requests.map((r) => r.url);
    assert.ok(paths.includes("/sitemap_products_1.xml"));
    assert.ok(!paths.includes("/sitemap_pages_1.xml") && !paths.includes("/sitemap_collections_1.xml"));
    assert.match(facts(get(report, "sitemap")), /sitemap index, 3 sitemaps/);
  });

  test("reports a valid Product rich result", async () => {
    const { report } = await check();
    const sd = facts(get(report, "structured-data"));
    assert.match(sd, /The home page: 1 JSON-LD block, rich results checked: Organization\./);
    assert.match(sd, /The product page: 1 JSON-LD block, rich results checked: Product snippet, Merchant listing\./);
    assert.match(sd, /Product rich result: Product snippet and Merchant listing valid\./);
  });

  test("reports crawler access for Googlebot and each AI crawler on both pages", async () => {
    const { report } = await check();
    const crawlers = get(report, "crawlers");
    assert.match(facts(crawlers), /Googlebot: home page allowed, product page allowed\./);
    assert.match(facts(crawlers), /1 blocked from the whole site \(GPTBot\)/);
    assert.match(facts(crawlers), /AI crawlers blocked from the home page and the product page: GPTBot\./);
    assert.deepEqual(report.crawlers?.googlebot, { home: true, product: true });
    const gpt = report.crawlers?.ai.find((c) => c.token === "GPTBot");
    const claude = report.crawlers?.ai.find((c) => c.token === "ClaudeBot");
    assert.deepEqual([gpt?.access, gpt?.home, gpt?.product], ["blocked", false, false]);
    assert.deepEqual([claude?.access, claude?.home, claude?.product], ["partial", true, true]);
  });

  test("fetches the fixed set of resources in order, each once, with its own User-Agent", async () => {
    const { report, store } = await check();
    assert.deepEqual(purposes(report), ["start URL", "http:// variant", "robots.txt", "home page", "sitemap", "child sitemap", "product page", "llms.txt"]);
    // The http:// redirect is answered by the fake fetch, so the store sees one request fewer.
    assert.equal(report.requestCount, 9);
    assert.equal(store.requests.length, 8);
    for (const r of store.requests) assert.equal(r.headers["user-agent"], "store-check (+https://github.com/idrisiRehan/websync-plugins)");
    for (const r of report.requests) {
      assert.equal(r.status, 200);
      assert.equal(r.error, null);
      assert.ok(r.durationMs >= 0);
    }
    assert.ok((report.requests.find((r) => r.purpose === "robots.txt")?.bytes ?? 0) > 0);
  });

  test("the report is plain JSON", async () => {
    const { report } = await check();
    assert.deepEqual(JSON.parse(JSON.stringify(report)), report);
  });
});

describe("redirects and HTTPS", () => {
  test("http:// that never reaches https is a warning", async () => {
    const { report } = await check({}, { plainHttp: true });
    const s = get(report, "redirects");
    assert.equal(s.status, "warnings");
    assert.deepEqual(rules(s), ["https-missing"]);
    assert.equal(s.findings[0].source, "redirect-inspector");
    assert.equal(s.findings[0].url, "http://shop.test/");
  });

  test("checks run on the host the start URL redirects to", async () => {
    const { report, store } = await check({}, { hosts: ["www.shop.test"], redirects: { "https://shop.test/": "https://www.shop.test/" } });
    assert.equal(report.site, "https://www.shop.test");
    assert.match(facts(get(report, "redirects")), /https:\/\/shop\.test\/ -> https:\/\/www\.shop\.test\/ \(301, then 200\)/);
    assert.equal(report.requests.find((r) => r.purpose === "robots.txt")?.url, "https://www.shop.test/robots.txt");
    assert.ok(store.requests.length > 0);
  });

  test("a home page that ends in an error leaves the page sections unavailable", async () => {
    const { report } = await check({ "/": { status: 500, body: "Internal error" } });
    assert.deepEqual(rules(get(report, "redirects")), ["final-status", "final-status"]);
    assert.equal(get(report, "home-page").status, "unavailable");
    assert.equal(get(report, "security-headers").status, "unavailable");
    assert.equal(get(report, "product-page").status, "pass");
    assert.ok(!purposes(report).includes("home page"));
  });

  test("a 403 or 429 home page gets a note about bot protection", async () => {
    const { report } = await check({ "/": { status: 403, body: "Forbidden" } });
    assert.match(facts(get(report, "redirects")), /A 403 often comes from bot protection or rate limiting/);
  });
});

describe("robots.txt and crawler access", () => {
  test("a robots.txt that blocks everything is an error for Googlebot on both pages", async () => {
    const { report } = await check({ "/robots.txt": text(`User-agent: *\nDisallow: /\n\nSitemap: ${ORIGIN}/sitemap.xml\n`) });
    assert.deepEqual(rules(get(report, "robots-txt")), ["disallow-all"]);
    const crawlers = get(report, "crawlers");
    assert.equal(crawlers.status, "errors");
    assert.deepEqual(rules(crawlers), ["googlebot-blocked", "googlebot-blocked"]);
    assert.match(facts(crawlers), /Googlebot: home page blocked by line 2 \("Disallow: \/"\), product page blocked by line 2/);
    assert.match(facts(crawlers), /21 blocked from the whole site/);
    assert.deepEqual(report.crawlers?.googlebot, { home: false, product: false });
  });

  test("blocking only AI crawlers is a fact, not a finding", async () => {
    const robots = `User-agent: *
Disallow: /checkout

User-agent: GPTBot
User-agent: CCBot
Disallow: /products/

Sitemap: ${ORIGIN}/sitemap.xml
`;
    const { report } = await check({ "/robots.txt": text(robots) });
    const crawlers = get(report, "crawlers");
    assert.equal(crawlers.status, "pass");
    assert.match(facts(crawlers), /Every listed AI crawler may fetch the home page\./);
    assert.match(facts(crawlers), /AI crawlers blocked from the product page: GPTBot, CCBot\./);
  });

  test("an HTML 404 at /robots.txt means no rules: everything is allowed, and /sitemap.xml is tried", async () => {
    const { report } = await check({ "/robots.txt": { status: 404, headers: { "content-type": "text/html" }, body: "<!doctype html><h1>Not found</h1>" } });
    const robots = get(report, "robots-txt");
    assert.equal(robots.status, "pass");
    assert.match(facts(robots), /No robots\.txt \(HTTP 404 at https:\/\/shop\.test\/robots\.txt\)/);
    assert.equal(get(report, "crawlers").status, "pass");
    assert.equal(report.crawlers?.ai.every((c) => c.access === "allowed"), true);
    assert.match(facts(get(report, "sitemap")), /robots\.txt has no Sitemap line, so store-check tried \/sitemap\.xml/);
    assert.equal(report.product?.source, "sitemap");
  });

  test("an HTML page served as robots.txt with 200 is the linter's file-html error", async () => {
    const { report } = await check({ "/robots.txt": html("<!doctype html><html><body><h1>Welcome</h1></body></html>") });
    assert.deepEqual(rules(get(report, "robots-txt")), ["file-html"]);
    assert.equal(get(report, "robots-txt").findings[0].source, "robots-txt-lint");
  });

  test("a 5xx robots.txt is an error, and crawler access is unknown", async () => {
    const { report } = await check({ "/robots.txt": { status: 503, body: "busy" } });
    assert.deepEqual(rules(get(report, "robots-txt")), ["robots-unreachable"]);
    assert.match(get(report, "robots-txt").findings[0].message, /RFC 9309 s2\.3\.1\.4/);
    assert.equal(get(report, "crawlers").status, "unavailable");
    assert.equal(report.crawlers, null);
  });

  test("robots.txt that isn't UTF-8 is an error, and the file is still linted", async () => {
    const bytes = Buffer.concat([Buffer.from("User-agent: *\nDisallow: /caf"), Buffer.from([0xe9]), Buffer.from("/\n")]);
    const { report } = await check({ "/robots.txt": { headers: { "content-type": "text/plain" }, body: bytes } });
    assert.deepEqual(rules(get(report, "robots-txt")), ["encoding-invalid"]);
    assert.equal(get(report, "crawlers").status, "pass");
  });
});

describe("sitemap", () => {
  test("no Sitemap line and no /sitemap.xml is a warning, and the product page is skipped", async () => {
    const { report } = await check({ "/robots.txt": text("User-agent: *\nDisallow: /cart\n"), "/sitemap.xml": { status: 404, body: "Not found" } });
    const s = get(report, "sitemap");
    assert.equal(s.status, "warnings");
    assert.deepEqual(rules(s), ["sitemap-missing"]);
    assert.equal(report.product, null);
    assert.equal(get(report, "product-page").status, "skipped");
    assert.match(facts(get(report, "product-page")), /no sitemap with page URLs could be read/);
    assert.match(facts(get(report, "structured-data")), /The home page: 1 JSON-LD block/);
  });

  test("a sitemap that robots.txt lists but that answers 404 is an error", async () => {
    const { report } = await check({ "/sitemap.xml": { status: 404, body: "Not found" } });
    const s = get(report, "sitemap");
    assert.equal(s.status, "errors");
    assert.deepEqual(rules(s), ["sitemap-unreachable"]);
    assert.match(s.findings[0].message, /although robots\.txt lists it/);
  });

  test("a gzipped sitemap is decompressed", async () => {
    const { report } = await check({
      "/robots.txt": text(`User-agent: *\nDisallow: /cart\n\nSitemap: ${ORIGIN}/sitemap.xml.gz\n`),
      "/sitemap.xml.gz": gzipped(urlset([`${ORIGIN}/`, `${ORIGIN}/products/wool-runner`])),
    });
    assert.equal(get(report, "sitemap").status, "pass");
    assert.match(facts(get(report, "sitemap")), /sitemap\.xml\.gz: 2 URLs/);
    assert.equal(report.product?.url, `${ORIGIN}/products/wool-runner`);
    assert.ok(!purposes(report).includes("child sitemap"));
  });

  test("a gzip file that can't be decompressed makes the sitemap unavailable", async () => {
    const { report } = await check({ "/sitemap.xml": { headers: { "content-type": "application/x-gzip" }, body: Buffer.from([0x1f, 0x8b, 1, 2, 3]) } });
    assert.equal(get(report, "sitemap").status, "unavailable");
    assert.match(facts(get(report, "sitemap")), /looks gzipped but could not be decompressed/);
  });

  test("the linter's findings on the index and the child are both reported, each with its URL", async () => {
    const { report } = await check({
      "/sitemap.xml": xml(`<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>${ORIGIN}/sitemap_products_1.xml</loc><lastmod>yesterday</lastmod></sitemap>
</sitemapindex>`),
      "/sitemap_products_1.xml": xml(urlset([`${ORIGIN}/products/wool-runner`, `${ORIGIN}/products/wool-runner`])),
    });
    const s = get(report, "sitemap");
    assert.deepEqual(
      s.findings.map((f) => [f.rule, f.url, f.source]),
      [
        ["lastmod-invalid", `${ORIGIN}/sitemap.xml`, "sitemap-lint"],
        ["loc-duplicate", `${ORIGIN}/sitemap_products_1.xml`, "sitemap-lint"],
      ],
    );
    assert.equal(s.findings[1].where, "entry 2, line 4");
  });

  test("a child sitemap that answers 404 is an error", async () => {
    const { report } = await check({ "/sitemap_products_1.xml": { status: 404, body: "gone" } });
    assert.deepEqual(rules(get(report, "sitemap")), ["sitemap-unreachable"]);
    assert.equal(report.product, null);
  });

  test("a sitemap on another host is fetched because robots.txt points to it, and says so", async () => {
    // storeFetch serves cdn.test from the same store, so the CDN's sitemap is the store's index.
    const { report } = await check({ "/robots.txt": text(`User-agent: *\nDisallow: /cart\n\nSitemap: https://cdn.test/sitemap.xml\n`) }, { hosts: ["cdn.test"] });
    assert.equal(report.requests.find((r) => r.purpose === "sitemap")?.url, "https://cdn.test/sitemap.xml");
    assert.match(facts(get(report, "sitemap")), /on another host \(cdn\.test\); it was fetched because robots\.txt points to it/);
    assert.equal(report.product?.url, `${ORIGIN}/products/wool-runner`);
  });

  test("a product URL on another host is never picked", async () => {
    const { report } = await check({ "/sitemap_products_1.xml": xml(urlset(["https://elsewhere.test/products/other"])) });
    assert.equal(report.product, null);
    assert.match(facts(get(report, "product-page")), /No product URL found in the sitemap/);
  });

  test("a child sitemap on another host is not fetched", async () => {
    const { report } = await check({ "/sitemap.xml": xml(`<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://elsewhere.test/sitemap_products_1.xml</loc></sitemap>
</sitemapindex>`) });
    assert.match(facts(get(report, "sitemap")), /child sitemaps are all on other hosts \(such as elsewhere\.test\), so none was fetched/);
    assert.ok(!purposes(report).includes("child sitemap"));
  });

  test("a child sitemap on another host is passed over for one on the site", async () => {
    // Apple's index lists other countries' sitemaps first.
    const { report } = await check({ "/sitemap.xml": xml(`<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap><loc>https://elsewhere.test/sitemap_products_1.xml</loc></sitemap>
  <sitemap><loc>${ORIGIN}/sitemap_products_1.xml</loc></sitemap>
</sitemapindex>`) });
    assert.equal(report.requests.find((r) => r.purpose === "child sitemap")?.url, `${ORIGIN}/sitemap_products_1.xml`);
    assert.equal(report.product?.url, `${ORIGIN}/products/wool-runner`);
  });
});

describe("llms.txt", () => {
  test("a missing llms.txt is skipped, not a problem", async () => {
    const { report } = await check({ "/llms.txt": { status: 404, body: "Not found" } });
    const s = get(report, "llms-txt");
    assert.equal(s.status, "skipped");
    assert.match(facts(s), /No llms\.txt \(HTTP 404/);
    assert.equal(report.errorCount + report.warningCount, 0);
  });

  test("an llms.txt that answers 429 is unavailable, not missing", async () => {
    const { report } = await check({ "/llms.txt": { status: 429, body: "Too many requests" } });
    assert.equal(get(report, "llms-txt").status, "unavailable");
    assert.match(facts(get(report, "llms-txt")), /answered HTTP 429\./);
  });

  test("an llms.txt with problems shows the linter's findings", async () => {
    const { report } = await check({ "/llms.txt": text("Just some text without a title.\n") });
    assert.equal(get(report, "llms-txt").status, "errors");
    assert.ok(get(report, "llms-txt").findings.every((f) => f.source === "llms-txt-kit"));
  });
});

describe("pages and structured data", () => {
  test("a product page without Product markup is a warning", async () => {
    const { report } = await check({ "/products/wool-runner": html(productPage(ORIGIN, "")) });
    const sd = get(report, "structured-data");
    assert.deepEqual(rules(sd), ["jsonld-missing", "product-markup-missing"]);
    assert.match(facts(sd), /Product rich result: none, because the product page has no Product markup\./);
  });

  test("invalid JSON-LD is the linter's error, and there is no Product rich result", async () => {
    const broken = ldScript(`{ "@context": "https://schema.org", "@type": "Product", "name": "Wool Runner", }`);
    const { report } = await check({ "/products/wool-runner": html(productPage(ORIGIN, broken)) });
    const sd = get(report, "structured-data");
    assert.equal(sd.status, "errors");
    assert.deepEqual(rules(sd), ["json-invalid", "product-markup-missing"]);
  });

  test("a Product with a missing price is checked but not valid", async () => {
    const noPrice = ldScript(`{
  "@context": "https://schema.org",
  "@type": "Product",
  "name": "Wool Runner",
  "image": "${ORIGIN}/images/wool-runner.jpg",
  "offers": { "@type": "Offer", "priceCurrency": "USD" }
}`);
    const { report } = await check({ "/products/wool-runner": html(productPage(ORIGIN, noPrice)) });
    const sd = get(report, "structured-data");
    assert.ok(rules(sd).includes("property-required"));
    assert.match(facts(sd), /Product rich result: Product snippet and Merchant listing checked, but the product page's structured data has \d+ errors?/);
    assert.ok(sd.findings.filter((f) => f.rule === "property-required").every((f) => f.url === `${ORIGIN}/products/wool-runner` && f.where?.includes("$")));
  });

  test("productUrl replaces the sitemap pick, and a product page that answers 404 is an error", async () => {
    const { report } = await check({}, { productUrl: `${ORIGIN}/products/discontinued` });
    assert.deepEqual(report.product, { url: `${ORIGIN}/products/discontinued`, source: "option" });
    const s = get(report, "product-page");
    assert.equal(s.status, "errors");
    assert.deepEqual(rules(s), ["page-status"]);
    assert.match(s.findings[0].message, /The product page https:\/\/shop\.test\/products\/discontinued answered HTTP 404\./);
  });

  test("productUrl on the www variant of the host is accepted", async () => {
    const { report } = await check({}, { productUrl: "https://www.shop.test/products/wool-runner", hosts: ["www.shop.test"] });
    assert.equal(report.product?.source, "option");
    assert.equal(get(report, "product-page").status, "pass");
  });

  test("a URL that isn't a product page is not picked", async () => {
    const { report } = await check({ "/sitemap_products_1.xml": xml(urlset([`${ORIGIN}/products/`, `${ORIGIN}/product-category/shoes/`, `${ORIGIN}/collections/all`])) });
    assert.equal(report.product, null);
    assert.equal(get(report, "product-page").status, "skipped");
  });

  test("metadata problems come from metacheck, with line numbers", async () => {
    const bare = `<!doctype html>
<html>
<head><title>Shoes</title></head>
<body><p>Hello</p></body>
</html>`;
    const { report } = await check({ "/": html(bare) });
    const home = get(report, "home-page");
    assert.equal(home.status, "warnings");
    assert.ok(home.findings.every((f) => f.source === "metacheck" && f.severity === "warning"));
    assert.equal(home.findings.find((f) => f.rule === "title-too-short")?.where, "line 3");
    assert.match(facts(home), /Title: "Shoes" \(5 characters\)\./);
  });

  test("a page larger than 10 MiB is not read", async () => {
    const { report } = await check({ "/": endless("text/html") });
    const home = get(report, "home-page");
    assert.equal(home.status, "unavailable");
    assert.match(facts(home), /larger than 10 MiB, so store-check stopped reading it/);
    // The headers arrived, so they are still graded.
    assert.equal(get(report, "security-headers").status, "errors");
  });
});

describe("security headers", () => {
  test("missing headers are security-header-audit's failures (errors) and warnings", async () => {
    const plain = { headers: { "content-type": "text/html", server: "nginx/1.25.3" }, body: page(ORIGIN, "/", "Example Shoes: Comfortable Wool Sneakers", "x".repeat(130), "") };
    const { report } = await check({ "/": plain });
    const s = get(report, "security-headers");
    assert.equal(s.status, "errors");
    assert.ok(s.findings.every((f) => f.source === "security-header-audit"));
    assert.deepEqual(
      s.findings.filter((f) => f.severity === "error").map((f) => f.rule),
      ["hsts-missing", "csp-missing", "clickjack-missing"],
    );
    assert.ok(rules(s).includes("info-disclosure"));
    assert.match(facts(s), /\d+\/100, (weak|needs-work)/);
  });
});

describe("limits", () => {
  test("a request that times out makes its section unavailable, and the run goes on", async () => {
    const begin = Date.now();
    const { report } = await check({ "/llms.txt": silent }, { timeoutMs: 300 });
    assert.equal(get(report, "llms-txt").status, "unavailable");
    assert.match(facts(get(report, "llms-txt")), /timed out after 300 ms/);
    assert.equal(report.requests.find((r) => r.purpose === "llms.txt")?.error, "timed out after 300 ms");
    assert.ok(Date.now() - begin < 5000);
  });

  test("a body that stops mid-stream still times out", async () => {
    const stall = (_req: unknown, res: import("node:http").ServerResponse) => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.write("User-agent: *\n");
    };
    const { report } = await check({ "/robots.txt": stall }, { timeoutMs: 300 });
    assert.equal(get(report, "robots-txt").status, "unavailable");
    assert.match(facts(get(report, "robots-txt")), /timed out after 300 ms/);
  });

  test("an endless robots.txt stops at 1 MiB", async () => {
    const { report } = await check({ "/robots.txt": endless("text/plain") });
    assert.equal(get(report, "robots-txt").status, "unavailable");
    assert.match(facts(get(report, "robots-txt")), /larger than 1 MiB/);
    assert.equal(get(report, "crawlers").status, "unavailable");
  });

  test("a gzip-encoded robots.txt stops at 1 MiB after decompression", async () => {
    const bomb = gzipSync(Buffer.alloc(64 * 1024 * 1024, 0x20));
    const { report } = await check({ "/robots.txt": { headers: { "content-type": "text/plain", "content-encoding": "gzip" }, body: bomb } });
    assert.ok(bomb.length < 1024 * 1024);
    assert.match(facts(get(report, "robots-txt")), /larger than 1 MiB/);
  });

  test("the request budget is never exceeded, even when every URL redirects", async () => {
    // Every path redirects to a longer one: / to /x, /robots.txt to /robots.txtx, ...
    const looping = await startStore(new Proxy({}, { get: (_t, path: string) => ({ status: 301, headers: { location: `${path}x` } }) }));
    stores.push(looping);
    const report = await checkStore(looping.base);
    assert.equal(report.requestCount, MAX_REQUESTS);
    assert.equal(looping.requests.length, MAX_REQUESTS);
    assert.deepEqual(rules(get(report, "redirects")), ["too-many-hops"]);
    const last = report.requests.at(-1)!;
    assert.match(last.error ?? "", /limit of 20 requests per run was reached/);
    assert.ok(report.requests.some((r) => r.error === "still redirecting after 5 redirects"));
  });

  test("redirects inside a fetch are followed and counted", async () => {
    const { report } = await check({ "/llms.txt": { status: 301, headers: { location: "/pages/llms.txt" } }, "/pages/llms.txt": text("# Example Shoes\n") });
    const llms = report.requests.find((r) => r.purpose === "llms.txt");
    assert.deepEqual([llms?.redirects, llms?.finalUrl, llms?.status], [1, `${ORIGIN}/pages/llms.txt`, 200]);
    assert.equal(report.requestCount, 10);
  });
});

describe("an unreachable site", () => {
  test("is reported, not thrown, and nothing else is fetched", async () => {
    const store = await startStore({});
    const base = store.base;
    store.close();
    const report = await checkStore(base, { timeoutMs: 2000 });
    assert.equal(report.reachable, false);
    assert.equal(report.requestCount, 1);
    assert.deepEqual(rules(get(report, "redirects")), ["request-failed"]);
    assert.ok(report.sections.filter((s) => s.id !== "redirects").every((s) => s.status === "unavailable"));
    assert.match(report.requests[0].error ?? "", /failed/);
  });
});

describe("bad input throws", () => {
  test("for a start URL that isn't absolute http(s)", async () => {
    await assert.rejects(checkStore("shop.test"), TypeError);
    await assert.rejects(checkStore("ftp://shop.test/"), /url must be an absolute http or https URL/);
  });

  test("for bad options", async () => {
    await assert.rejects(checkStore(ORIGIN, { productUrl: "/products/x" }), /productUrl must be an absolute http or https URL/);
    await assert.rejects(checkStore(ORIGIN, { productUrl: "https://elsewhere.test/products/x" }), /productUrl must be on the store's host \(shop\.test\)/);
    await assert.rejects(checkStore(ORIGIN, { timeoutMs: 0 }), RangeError);
    await assert.rejects(checkStore(ORIGIN, { userAgent: " " }), TypeError);
    await assert.rejects(checkStore(ORIGIN, { fetch: "nope" as unknown as typeof fetch }), TypeError);
  });
});

describe("no false positives", () => {
  test("a Shopify ProductGroup of variants is Product markup, though schemaview doesn't check it", async () => {
    const group = ldScript(`{
  "@context": "https://schema.org",
  "@type": "ProductGroup",
  "name": "Wool Runner",
  "productGroupID": "WR",
  "hasVariant": [{ "@type": "Product", "name": "Wool Runner - 8", "sku": "WR-8", "offers": { "@type": "Offer", "price": "98.00", "priceCurrency": "USD" } }]
}`);
    const { report } = await check({ "/products/wool-runner": html(productPage(ORIGIN, group)) });
    const sd = get(report, "structured-data");
    assert.ok(!rules(sd).includes("product-markup-missing"));
    assert.match(facts(sd), /Product rich result: not checked\. The product page's Product markup is a ProductGroup \(product variants\)/);
  });

  test("Product markup in Microdata or RDFa is not reported missing", async () => {
    for (const markup of ['<div itemscope itemtype="https://schema.org/Product"><span itemprop="name">Wool Runner</span></div>', '<div vocab="https://schema.org/" typeof="Product"><span property="name">Wool Runner</span></div>']) {
      const { report } = await check({ "/products/wool-runner": html(productPage(ORIGIN, markup)) });
      const sd = get(report, "structured-data");
      assert.deepEqual(rules(sd), ["jsonld-missing"]);
      assert.match(facts(sd), /Product rich result: not checked\. The product page marks up its Product with Microdata or RDFa/);
    }
  });

  test("a /sitemap.xml that answers 403 is not reported missing", async () => {
    const { report } = await check({ "/robots.txt": text("User-agent: *\nDisallow: /cart\n"), "/sitemap.xml": { status: 403, body: "Forbidden" } });
    const s = get(report, "sitemap");
    assert.equal(s.status, "unavailable");
    assert.deepEqual(rules(s), []);
    assert.match(facts(s), /sitemap\.xml answered HTTP 403\./);
  });

  test("a /sitemap.xml that answers 200 with an HTML page is a missing sitemap, not malformed XML", async () => {
    const { report } = await check({ "/robots.txt": text("User-agent: *\nDisallow: /cart\n"), "/sitemap.xml": html("<!doctype html><html><body><h1>Not found</h1></body></html>") });
    const s = get(report, "sitemap");
    assert.deepEqual(rules(s), ["sitemap-missing"]);
    assert.match(s.findings[0].message, /answered with an HTML page, not a sitemap/);
  });

  test("a sitemap is not reported missing when robots.txt couldn't be read", async () => {
    const { report } = await check({ "/robots.txt": { status: 503, body: "busy" }, "/sitemap.xml": { status: 404, body: "Not found" } });
    const s = get(report, "sitemap");
    assert.deepEqual(rules(s), []);
    assert.equal(s.status, "unavailable");
  });

  test("an llms.txt that answers 200 with an HTML page is no llms.txt", async () => {
    const { report } = await check({ "/llms.txt": html("<!doctype html><html><body><h1>Not found</h1></body></html>") });
    const s = get(report, "llms-txt");
    assert.equal(s.status, "skipped");
    assert.match(facts(s), /No llms\.txt: https:\/\/shop\.test\/llms\.txt answered HTTP 200 with an HTML page/);
  });

  test("a 403 is not called a missing file", async () => {
    const { report } = await check({ "/robots.txt": { status: 403, body: "Forbidden" }, "/llms.txt": { status: 403, body: "Forbidden" } });
    assert.match(facts(get(report, "robots-txt")), /robots\.txt answered HTTP 403\. Crawlers that get the same answer treat it as no rules/);
    assert.doesNotMatch(facts(get(report, "robots-txt")), /No robots\.txt/);
    assert.equal(get(report, "llms-txt").status, "unavailable");
  });
});
