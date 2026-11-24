import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createLogAnalyzer, reportHighlights, IpRangeSet, type CrawlerStats, type LogReport } from "../src/index.ts";
import { TopCounter } from "../src/top.ts";

const UA = {
  gptbot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.4; +https://openai.com/gptbot",
  claudebot: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
  meta: "meta-externalagent/1.1",
  googlebot: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
  chrome: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0.0.0 Safari/537.36",
};
const GPTBOT_LIST = "https://openai.com/gptbot.json";
const ANTHROPIC_LIST = "https://claude.com/crawling/bots.json";

let second = 0;
function line(ip: string, path: string, ua: string, status = 200, bytes: number | "-" = 100): string {
  const s = String(second++ % 60).padStart(2, "0");
  return `${ip} - - [24/Nov/2026:10:00:${s} +0000] "GET ${path} HTTP/1.1" ${status} ${bytes} "-" "${ua}"`;
}

function analyze(lines: string[], options: Parameters<typeof createLogAnalyzer>[0] = {}): LogReport {
  const analyzer = createLogAnalyzer(options);
  for (const l of lines) analyzer.add(l);
  return analyzer.result();
}

const crawler = (report: LogReport, token: string): CrawlerStats => report.crawlers.find((c) => c.token === token)!;

describe("verification", () => {
  const ranges = { [GPTBOT_LIST]: ["132.196.86.0/24", "2001:db8:aaaa::/48"] };
  const lines = [
    line("132.196.86.12", "/products/a", UA.gptbot),
    line("::ffff:132.196.86.13", "/products/a", UA.gptbot),
    line("2001:db8:aaaa:1::9", "/", UA.gptbot),
    line("203.0.113.5", "/wp-login.php", UA.gptbot, 404),
    line("203.0.113.6", "/products/b", UA.gptbot),
    line("shop-proxy.internal", "/", UA.gptbot),
  ];

  test("addresses in the operator's list are verified, others spoofed, non-addresses unverified", () => {
    const g = crawler(analyze(lines, { ranges }), "GPTBot");
    assert.equal(g.verification, "checked");
    assert.deepEqual([g.requests, g.verified, g.spoofed, g.unverified], [6, 3, 2, 1]);
  });

  test("spoofed requests are left out of the per-path statistics", () => {
    const g = crawler(analyze(lines, { ranges }), "GPTBot");
    assert.deepEqual(g.status, { "2xx": 4, "3xx": 0, "4xx": 0, "5xx": 0 });
    assert.equal(g.productPages, 2);
    assert.deepEqual(g.topProducts, [{ path: "/products/a", requests: 2, overcount: 0 }]);
    assert.equal(g.spoofedNetworks, null);
  });

  test("an IpRangeSet works as well as CIDR strings", () => {
    const g = crawler(analyze(lines, { ranges: { [GPTBOT_LIST]: new IpRangeSet(ranges[GPTBOT_LIST]) } }), "GPTBot");
    assert.deepEqual([g.verified, g.spoofed], [3, 2]);
  });

  test("with networks, spoofed requests are counted by /24 or /48, never by full address", () => {
    const g = crawler(analyze(lines, { ranges, networks: true }), "GPTBot");
    assert.deepEqual(g.spoofedNetworks, [{ network: "203.0.113.0/24", requests: 2, overcount: 0 }]);
  });

  test("crawlers whose operator publishes no list are unverifiable, never spoofed", () => {
    const m = crawler(analyze([line("203.0.113.5", "/", UA.meta)], { ranges }), "meta-externalagent");
    assert.equal(m.verification, "unverifiable");
    assert.deepEqual([m.verified, m.spoofed, m.unverified], [0, 0, 1]);
  });

  test("crawlers whose list wasn't given are unchecked, never spoofed", () => {
    const report = analyze([line("203.0.113.5", "/", UA.claudebot)], { ranges });
    const c = crawler(report, "ClaudeBot");
    assert.equal(c.verification, "unchecked");
    assert.deepEqual([c.verified, c.spoofed, c.unverified], [0, 0, 1]);
    assert.equal(crawler(analyze([], {}), "GPTBot").verification, "unchecked");
  });

  test("one list serves every crawler that names it", () => {
    const report = analyze([line("216.73.216.40", "/", UA.claudebot), line("216.73.216.41", "/", "Claude-User/1.0")], { ranges: { [ANTHROPIC_LIST]: ["216.73.216.0/22"] } });
    assert.equal(crawler(report, "ClaudeBot").verified, 1);
    assert.equal(crawler(report, "Claude-User").verified, 1);
  });
});

describe("per-crawler statistics", () => {
  test("status classes, bytes, first and last seen, other traffic", () => {
    const report = analyze([
      `132.196.86.1 - - [24/Nov/2026:09:00:00 +0000] "GET /a HTTP/1.1" 200 1000 "-" "${UA.gptbot}"`,
      `132.196.86.1 - - [24/Nov/2026:11:30:00 +0100] "GET /b HTTP/1.1" 301 - "-" "${UA.gptbot}"`,
      `132.196.86.1 - - [24/Nov/2026:09:30:00 +0000] "GET /c HTTP/1.1" 404 50 "-" "${UA.gptbot}"`,
      `132.196.86.1 - - [24/Nov/2026:09:40:00 +0000] "GET /d HTTP/1.1" 503 50 "-" "${UA.gptbot}"`,
      `192.0.2.1 - - [24/Nov/2026:08:00:00 +0000] "GET / HTTP/1.1" 200 7 "-" "${UA.chrome}"`,
      `192.0.2.1 - - [24/Nov/2026:08:00:00 +0000] "GET / HTTP/1.1" 200 3`,
    ]);
    const g = crawler(report, "GPTBot");
    assert.deepEqual(g.status, { "2xx": 1, "3xx": 1, "4xx": 1, "5xx": 1 });
    assert.equal(g.bytes, 1100);
    assert.equal(g.firstSeen, "2026-11-24T09:00:00.000Z");
    assert.equal(g.lastSeen, "2026-11-24T10:30:00.000Z");
    assert.deepEqual(report.other, { requests: 2, bytes: 10 });
    assert.deepEqual([report.lines, report.parsed, report.unparsed], [6, 6, 0]);
    assert.equal(report.firstSeen, "2026-11-24T08:00:00.000Z");
  });

  test("bytes is null when no line logged a size", () => {
    const report = analyze([JSON.stringify({ request_uri: "/", status: 200, http_user_agent: "GPTBot" })]);
    assert.equal(crawler(report, "GPTBot").bytes, null);
    assert.equal(crawler(report, "ClaudeBot").bytes, null);
  });

  test("paths are counted without the query string; errors by path", () => {
    const g = crawler(
      analyze([
        line("1.1.1.1", "/products/a?utm_source=x", UA.gptbot),
        line("1.1.1.1", "/products/a?utm_source=y", UA.gptbot),
        line("1.1.1.1", "/products/gone", UA.gptbot, 404),
        line("1.1.1.1", "/products/gone#top", UA.gptbot, 404),
        line("1.1.1.1", "http://shop.example/products/gone?x", UA.gptbot, 410),
      ]),
      "GPTBot",
    );
    assert.deepEqual(g.topPaths, [
      { path: "/products/gone", requests: 3, overcount: 0 },
      { path: "/products/a", requests: 2, overcount: 0 },
    ]);
    assert.deepEqual(g.topErrors, [{ path: "/products/gone", requests: 3, overcount: 0 }]);
  });

  test("robots.txt, llms.txt and sitemap requests", () => {
    const g = crawler(
      analyze(["/robots.txt", "/robots.txt", "/llms.txt", "/llms-full.txt", "/sitemap.xml", "/sitemap_products_1.xml?from=1", "/wp-sitemap.xml", "/product-sitemap.xml.gz", "/sitemaps/", "/Robots.txt"].map((p) => line("1.1.1.1", p, UA.gptbot))),
      "GPTBot",
    );
    assert.deepEqual([g.robotsTxt, g.llmsTxt, g.sitemaps], [2, 2, 4]);
  });

  test("product pages: Shopify and WooCommerce by default", () => {
    const paths = ["/products/wool-runner", "/en-gb/products/wool-runner", "/collections/sale/products/x", "/product/blue-mug/", "/products/", "/products", "/my-product/x", "/productsx/y"];
    const g = crawler(analyze(paths.map((p) => line("1.1.1.1", p, UA.gptbot))), "GPTBot");
    assert.equal(g.productPages, 4);
  });

  test("product pages: custom patterns with *", () => {
    const paths = ["/shop/p/123", "/shop/x/p/123", "/p/1", "/shop/p/", "/products/a"];
    const g = crawler(analyze(paths.map((p) => line("1.1.1.1", p, UA.gptbot)), { productPatterns: ["/shop/*/p/", "/shop/p/"] }), "GPTBot");
    assert.equal(g.productPages, 2);
  });

  test("top lists are cut to `top`", () => {
    const lines = Array.from({ length: 50 }, (_, i) => line("1.1.1.1", `/products/p${i}`, UA.gptbot));
    const g = crawler(analyze(lines, { top: 3 }), "GPTBot");
    assert.equal(g.topPaths.length, 3);
    assert.equal(g.topProducts.length, 3);
  });

  test("lists every table crawler, AI first, even those never seen", () => {
    const report = analyze([]);
    assert.ok(report.crawlers.length > 15);
    assert.equal(report.crawlers.at(-1)?.kind, "search");
    assert.deepEqual([report.firstSeen, report.lastSeen, report.lines], [null, null, 0]);
  });

  test("blank lines are skipped; unreadable lines are counted", () => {
    const report = analyze(["", "   ", "garbage", line("1.1.1.1", "/", UA.gptbot), "\u0000\u0001"]);
    assert.deepEqual([report.lines, report.parsed, report.unparsed], [3, 1, 2]);
  });

  test("result() can be called mid-stream", () => {
    const analyzer = createLogAnalyzer();
    analyzer.add(line("1.1.1.1", "/", UA.gptbot));
    assert.equal(crawler(analyzer.result(), "GPTBot").requests, 1);
    analyzer.add(line("1.1.1.1", "/", UA.gptbot));
    assert.equal(crawler(analyzer.result(), "GPTBot").requests, 2);
  });
});

describe("options", () => {
  test("invalid options throw a TypeError", () => {
    assert.throws(() => createLogAnalyzer({ format: "apache" as never }), TypeError);
    assert.throws(() => createLogAnalyzer({ top: 0 }), TypeError);
    assert.throws(() => createLogAnalyzer({ top: 101 }), TypeError);
    assert.throws(() => createLogAnalyzer({ top: 2.5 }), TypeError);
    assert.throws(() => createLogAnalyzer({ productPatterns: ["products/"] }), TypeError);
    assert.throws(() => createLogAnalyzer({ productPatterns: ["/a b/"] }), TypeError);
    assert.throws(() => createLogAnalyzer({ productPatterns: "/products/" as never }), TypeError);
    assert.throws(() => createLogAnalyzer({ ranges: { x: "1.2.3.4/32" as never } }), TypeError);
  });

  test("format json reads only JSON lines; common ignores user agents", () => {
    const l = line("1.1.1.1", "/", UA.gptbot);
    assert.equal(analyze([l], { format: "json" }).parsed, 0);
    assert.equal(crawler(analyze([l], { format: "common" }), "GPTBot").requests, 0);
  });
});

describe("bounded memory and linear time", () => {
  test("the top counter never holds more than its capacity", () => {
    const counter = new TopCounter(100);
    for (let i = 0; i < 200_000; i++) counter.add(`/p/${i}`);
    assert.equal(counter.size, 100);
  });

  test("a frequent key is always kept, with a count bounded by the guarantee", () => {
    const counter = new TopCounter(100);
    let n = 0;
    for (let i = 0; i < 100_000; i++) {
      counter.add(`/unique/${i}`);
      n++;
      if (i % 10 === 0) {
        counter.add("/hot");
        n++;
      }
    }
    const hot = counter.top(1)[0];
    assert.equal(hot.key, "/hot");
    assert.ok(hot.count >= 10_000, "never under the true count");
    assert.ok(hot.count - 10_000 <= hot.overcount && hot.overcount <= n / 100, "overcount within n/m");
  });

  test("counts are exact while there are fewer keys than slots", () => {
    const counter = new TopCounter(10);
    for (const key of ["a", "b", "a", "c", "a", "b"]) counter.add(key);
    assert.deepEqual(counter.top(5), [
      { key: "a", count: 3, overcount: 0 },
      { key: "b", count: 2, overcount: 0 },
      { key: "c", count: 1, overcount: 0 },
    ]);
  });

  test("millions of distinct paths keep the report small", () => {
    const analyzer = createLogAnalyzer({ top: 5 });
    for (let i = 0; i < 300_000; i++) analyzer.add(line("132.196.86.1", `/products/item-${i}?q=${i}`, UA.gptbot));
    for (let i = 0; i < 5_000; i++) analyzer.add(line("132.196.86.1", "/products/best-seller", UA.gptbot));
    const g = crawler(analyzer.result(), "GPTBot");
    assert.equal(g.requests, 305_000);
    assert.equal(g.topPaths[0].path, "/products/best-seller");
    assert.ok(g.topPaths[0].requests >= 5_000);
    assert.ok(g.topPaths.slice(1).every((p) => p.overcount > 0), "the rest are marked as estimates");
  });

  test("a million lines take linear time", () => {
    const ranges = { [GPTBOT_LIST]: ["132.196.86.0/24"], [ANTHROPIC_LIST]: ["216.73.216.0/22"] };
    const sample = [
      line("132.196.86.12", "/products/a", UA.gptbot),
      line("203.0.113.9", "/wp-login.php", UA.gptbot, 404),
      line("216.73.216.40", "/llms.txt", UA.claudebot),
      line("192.0.2.1", "/collections/all", UA.chrome),
      line("2001:db8::1", "/cart", UA.chrome, 302, "-"),
      JSON.stringify({ ClientIP: "192.0.2.4", ClientRequestURI: "/", EdgeResponseStatus: 200, ClientRequestUserAgent: UA.googlebot }),
      "not a log line",
    ];
    const run = (n: number) => {
      const analyzer = createLogAnalyzer({ ranges });
      const start = performance.now();
      for (let i = 0; i < n; i++) analyzer.add(sample[i % sample.length]);
      analyzer.result();
      return performance.now() - start;
    };
    run(20_000); // warm up
    const small = run(100_000);
    const large = run(1_000_000);
    assert.ok(large < 30_000, `1M lines took ${Math.round(large)} ms`);
    assert.ok(large < small * 25, `10x the lines took ${(large / small).toFixed(1)}x the time`);
  });
});

test("never throws on random input", () => {
  let seed = 7;
  const random = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const pieces = [line("132.196.86.1", "/products/a", UA.gptbot), '{"ClientIP":', '"', "\\", "[", "]", " ", "GPTBot", "::ffff:", "/", "-", "\n", "{}"];
  const analyzer = createLogAnalyzer({ ranges: { [GPTBOT_LIST]: ["132.196.86.0/24", "bad"] }, networks: true });
  for (let i = 0; i < 20_000; i++) {
    let l = "";
    for (let j = Math.floor(random() * 8); j > 0; j--) {
      const piece = pieces[Math.floor(random() * pieces.length)];
      l += random() < 0.3 ? piece.slice(0, Math.floor(random() * piece.length)) : piece;
    }
    analyzer.add(l);
  }
  analyzer.add(undefined as unknown as string);
  const report = analyzer.result();
  assert.equal(report.lines, report.parsed + report.unparsed);
  reportHighlights(report);
});

describe("reportHighlights", () => {
  const ranges = { [GPTBOT_LIST]: ["132.196.86.0/24"], "https://developers.google.com/static/crawling/ipranges/common-crawlers.json": ["66.249.64.0/27"] };
  const report = analyze(
    [
      ...Array.from({ length: 1204 }, () => line("203.0.113.5", "/", UA.gptbot)),
      ...Array.from({ length: 3 }, () => line("132.196.86.1", "/products/a", UA.gptbot)),
      ...Array.from({ length: 312 }, (_, i) => line("216.73.216.1", i % 2 ? "/products/old" : "/products/older", UA.claudebot, 404)),
      line("216.73.216.1", "/llms.txt", UA.claudebot),
      line("2001:db8::1", "/products/a", UA.meta),
      line("66.249.64.1", "/", UA.googlebot),
      line("192.0.2.1", "/", UA.chrome),
    ],
    { ranges },
  );
  const highlights = reportHighlights(report);

  test("say who was faked, by how many requests", () => {
    assert.ok(highlights.includes("1,204 requests claimed GPTBot from addresses OpenAI doesn't publish."), highlights.join("\n"));
  });

  test("say which crawler got errors, and where most of them were", () => {
    assert.ok(highlights.includes("ClaudeBot got 312 error responses (4xx or 5xx), most on /products/old (156)."), highlights.join("\n"));
  });

  test("cover share, products, llms.txt, unverifiable and unchecked crawlers", () => {
    assert.match(highlights[0], /^AI crawlers made 1,521 of 1,523 requests \(99\.9%\); the search engines counted here made 1\.$/);
    assert.ok(highlights.includes("Product pages fetched: ClaudeBot 312, GPTBot 3 and meta-externalagent 1."), highlights.join("\n"));
    assert.ok(highlights.includes("llms.txt was requested by ClaudeBot (1)."));
    assert.ok(highlights.includes("1 request from meta-externalagent can't be verified: its operator publishes no IP addresses."));
    assert.ok(highlights.includes("313 requests from ClaudeBot weren't checked, because the IP lists weren't loaded."));
  });

  test("nothing to say about an empty log; a log without AI crawlers says so", () => {
    assert.deepEqual(reportHighlights(analyze([])), []);
    assert.deepEqual(reportHighlights(analyze([line("1.1.1.1", "/", UA.chrome)])), ["No request named one of the AI crawlers."]);
  });
});
