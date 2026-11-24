import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { lintSitemap, MAX_ENTRIES, type RuleId, type SitemapResult } from "../src/lint.ts";

const NS = "http://www.sitemaps.org/schemas/sitemap/0.9";

function urlset(body: string, attrs = `xmlns="${NS}"`): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset ${attrs}>\n${body}\n</urlset>`;
}

function url(loc: string, extra = ""): string {
  return `<url><loc>${loc}</loc>${extra}</url>`;
}

function rules(result: SitemapResult): RuleId[] {
  return result.findings.map((f) => f.rule);
}

function only(result: SitemapResult, rule: RuleId) {
  const found = result.findings.filter((f) => f.rule === rule);
  assert.equal(found.length, 1, `expected one ${rule}, got: ${JSON.stringify(result.findings)}`);
  return found[0];
}

describe("valid sitemaps", () => {
  test("a clean urlset has no findings and lists its locs", () => {
    const r = lintSitemap(
      urlset(
        [
          url("https://example.com/", "<lastmod>2026-11-24</lastmod><changefreq>weekly</changefreq><priority>0.8</priority>"),
          url("https://example.com/a?x=1&amp;y=2", "<lastmod>2026-11-24T09:30:00+05:30</lastmod>"),
        ].join("\n"),
      ),
    );
    assert.deepEqual(r.findings, []);
    assert.equal(r.valid, true);
    assert.equal(r.kind, "urlset");
    assert.equal(r.entryCount, 2);
    assert.deepEqual(r.locs, ["https://example.com/", "https://example.com/a?x=1&y=2"]);
  });

  test("a clean sitemap index", () => {
    const r = lintSitemap(`<sitemapindex xmlns="${NS}"><sitemap><loc>https://example.com/s1.xml</loc><lastmod>2026-11</lastmod></sitemap></sitemapindex>`);
    assert.deepEqual(r.findings, []);
    assert.equal(r.kind, "sitemapindex");
  });

  test("extension namespaces (image, xhtml) are ignored, not flagged", () => {
    const r = lintSitemap(
      urlset(
        url("https://example.com/", `<image:image><image:loc>https://example.com/a.jpg</image:loc></image:image><xhtml:link rel="alternate" hreflang="de" href="https://example.com/de/"/>`),
        `xmlns="${NS}" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1" xmlns:xhtml="http://www.w3.org/1999/xhtml"`,
      ),
    );
    assert.deepEqual(r.findings, []);
  });

  test("CDATA in loc and surrounding whitespace are accepted", () => {
    assert.deepEqual(lintSitemap(urlset("<url><loc>\n  <![CDATA[https://example.com/a?b=1&c=2]]>\n</loc></url>")).findings, []);
  });

  test("bytes input is decoded as UTF-8 (a BOM is fine)", () => {
    const bytes = new TextEncoder().encode(`﻿${urlset(url("https://example.com/"))}`);
    assert.deepEqual(lintSitemap(bytes).findings, []);
  });
});

describe("file-level rules", () => {
  test("invalid UTF-8 bytes", () => {
    const bytes = new Uint8Array([...new TextEncoder().encode("<urlset><url><loc>https://e.com/"), 0xff, ...new TextEncoder().encode("</loc></url></urlset>")]);
    const r = lintSitemap(bytes);
    assert.deepEqual(rules(r), ["encoding-invalid"]);
    assert.equal(r.valid, false);
  });

  test("a non-UTF-8 encoding declaration", () => {
    const r = lintSitemap(`<?xml version="1.0" encoding="windows-1252"?><urlset xmlns="${NS}">${url("https://e.com/")}</urlset>`);
    assert.equal(only(r, "encoding-declared").severity, "warning");
  });

  test("malformed XML stops linting, with the line", () => {
    const r = lintSitemap(urlset(url("https://e.com/?a=1&b=2")));
    const f = only(r, "xml-malformed");
    assert.equal(f.line, 3);
    assert.match(f.message, /&amp;/);
    assert.equal(r.kind, null);
  });

  test("a DOCTYPE is a warning", () => {
    assert.equal(only(lintSitemap(`<!DOCTYPE urlset><urlset xmlns="${NS}">${url("https://e.com/")}</urlset>`), "xml-doctype").severity, "warning");
  });

  test("an over-50 MB file is an error but is still linted", () => {
    const pad = `<!--${"x".repeat(50 * 1024 * 1024)}-->`;
    const r = lintSitemap(urlset(url("https://e.com/") + pad));
    assert.deepEqual(rules(r), ["file-too-large"]);
    assert.equal(r.entryCount, 1);
  });
});

describe("root rules", () => {
  test("an unknown root element", () => {
    const r = lintSitemap("<rss><channel/></rss>");
    assert.deepEqual(rules(r), ["root-unknown"]);
    assert.equal(r.kind, null);
  });

  test("a missing namespace is a warning, and entries are still checked", () => {
    const r = lintSitemap("<urlset><url><loc>nope</loc></url></urlset>");
    assert.deepEqual(rules(r), ["root-namespace", "loc-invalid"]);
  });

  test("a wrong namespace is a warning", () => {
    assert.match(only(lintSitemap(urlset(url("https://e.com/"), `xmlns="http://www.google.com/schemas/sitemap/0.84"`)), "root-namespace").message, /0\.84/);
  });

  test("no entries", () => {
    assert.deepEqual(rules(lintSitemap(urlset(""))), ["entries-empty"]);
  });

  test("more than 50,000 entries", () => {
    const body = Array.from({ length: MAX_ENTRIES + 1 }, (_, i) => url(`https://e.com/${i}`)).join("");
    const r = lintSitemap(urlset(body));
    assert.deepEqual(rules(r), ["entries-too-many"]);
    assert.equal(r.entryCount, MAX_ENTRIES + 1);
  });

  test("<sitemap> inside <urlset>, and <url> inside <sitemapindex>", () => {
    assert.deepEqual(rules(lintSitemap(urlset(url("https://e.com/") + "<sitemap><loc>https://e.com/s.xml</loc></sitemap>"))), ["entry-wrong-type"]);
    assert.deepEqual(rules(lintSitemap(`<sitemapindex xmlns="${NS}">${url("https://e.com/")}</sitemapindex>`)), ["entry-wrong-type", "entries-empty"]);
  });

  test("an unknown element directly in the root", () => {
    assert.equal(only(lintSitemap(urlset(url("https://e.com/") + "<link/>")), "element-unknown").line, 3);
  });
});

describe("entry rules", () => {
  test("unknown and repeated elements inside an entry", () => {
    const r = lintSitemap(urlset(url("https://e.com/", "<lastmode>2026-01-01</lastmode><priority>0.5</priority><priority>0.6</priority>")));
    assert.deepEqual(rules(r), ["element-unknown", "element-repeated"]);
    assert.match(r.findings[0].message, /<lastmode>/);
  });

  test("index entries allow only loc and lastmod", () => {
    const r = lintSitemap(`<sitemapindex xmlns="${NS}"><sitemap><loc>https://e.com/s.xml</loc><priority>1</priority></sitemap></sitemapindex>`);
    assert.deepEqual(rules(r), ["element-unknown"]);
  });

  test("missing and empty loc", () => {
    assert.deepEqual(rules(lintSitemap(urlset("<url><lastmod>2026-01-01</lastmod></url>"))), ["loc-missing"]);
    assert.deepEqual(rules(lintSitemap(urlset("<url><loc> </loc></url>"))), ["loc-empty"]);
  });

  test("findings carry the entry number and line", () => {
    const f = only(lintSitemap(urlset(`${url("https://e.com/")}\n${url("not a url")}`)), "loc-invalid");
    assert.equal(f.entry, 2);
    assert.equal(f.line, 4);
  });

  test("relative and non-http URLs", () => {
    assert.deepEqual(rules(lintSitemap(urlset(url("/about/")))), ["loc-invalid"]);
    assert.deepEqual(rules(lintSitemap(urlset(url("ftp://e.com/file")))), ["loc-scheme"]);
  });

  test("a loc of 2,048 characters or more", () => {
    const long = `https://e.com/${"a".repeat(2048 - 14)}`;
    assert.equal(long.length, 2048);
    assert.deepEqual(rules(lintSitemap(urlset(url(long)))), ["loc-too-long"]);
    assert.deepEqual(rules(lintSitemap(urlset(url(long.slice(0, -1))))), []);
  });

  test("characters that need percent-encoding", () => {
    assert.deepEqual(rules(lintSitemap(urlset(url("https://e.com/a b")))), ["loc-unescaped"]);
    assert.deepEqual(rules(lintSitemap(urlset(url("https://e.com/café")))), ["loc-unescaped"]);
    assert.deepEqual(rules(lintSitemap(urlset(url("https://e.com/caf%C3%A9")))), []);
  });

  test("duplicate locs point at the first occurrence", () => {
    const f = only(lintSitemap(urlset(`${url("https://e.com/")}\n${url("https://e.com/")}`)), "loc-duplicate");
    assert.match(f.message, /entry 1 \(line 3\)/);
    assert.equal(f.entry, 2);
  });

  test("more than one host", () => {
    assert.deepEqual(rules(lintSitemap(urlset(url("https://e.com/") + url("https://www.e.com/")))), ["hosts-multiple"]);
  });
});

describe("lastmod", () => {
  const lint = (v: string) => rules(lintSitemap(urlset(url("https://e.com/", `<lastmod>${v}</lastmod>`))));

  test("accepts every W3C Datetime form", () => {
    for (const v of ["2026", "2026-11", "2026-11-24", "2026-11-24T09:30Z", "2026-11-24T09:30:15+05:30", "2026-11-24T09:30:15.123-08:00", "2024-02-29"]) {
      assert.deepEqual(lint(v), [], v);
    }
  });

  test("rejects other formats and impossible values", () => {
    for (const v of ["24/11/2026", "2026-11-24 09:30:00", "2026-11-24T09:30:00", "2026-13-01", "2026-02-29", "2026-04-31", "2026-11-24T24:00:00Z", "2026-11-24T09:60Z", "2026-11-24T09:30+25:00", "yesterday"]) {
      assert.deepEqual(lint(v), ["lastmod-invalid"], v);
    }
  });

  test("an empty lastmod is ignored", () => assert.deepEqual(lint(""), []));
});

describe("changefreq and priority", () => {
  test("changefreq values", () => {
    const lint = (v: string) => rules(lintSitemap(urlset(url("https://e.com/", `<changefreq>${v}</changefreq>`))));
    assert.deepEqual(lint("daily"), []);
    assert.deepEqual(lint("Daily"), []);
    assert.deepEqual(lint("fortnightly"), ["changefreq-invalid"]);
    assert.deepEqual(lint(""), ["changefreq-invalid"]);
  });

  test("priority values", () => {
    const lint = (v: string) => rules(lintSitemap(urlset(url("https://e.com/", `<priority>${v}</priority>`))));
    for (const v of ["0", "0.0", "0.5", ".5", "1", "1.0"]) assert.deepEqual(lint(v), [], v);
    for (const v of ["1.1", "-0.1", "high", "", "1e-1", "0x1"]) assert.deepEqual(lint(v), ["priority-invalid"], v);
  });
});

describe("counts", () => {
  test("errorCount, warningCount and valid agree with the findings", () => {
    const r = lintSitemap(urlset(`${url("nope")}${url("https://e.com/", "<priority>9</priority>")}`));
    assert.equal(r.errorCount, 1);
    assert.equal(r.warningCount, 1);
    assert.equal(r.valid, false);
  });

  test("lints 50,000 entries quickly", () => {
    const body = Array.from({ length: MAX_ENTRIES }, (_, i) => url(`https://e.com/p/${i}`, "<lastmod>2026-11-24</lastmod>")).join("\n");
    const started = performance.now();
    const r = lintSitemap(urlset(body));
    const ms = performance.now() - started;
    assert.equal(r.entryCount, MAX_ENTRIES);
    assert.deepEqual(r.findings, []);
    assert.ok(ms < 5000, `took ${Math.round(ms)} ms`);
  });

  test("a large sitemap on a single line stays linear", () => {
    // Real sitemaps are often minified onto one line (one retailer serves 50 MB that way).
    const body = Array.from({ length: MAX_ENTRIES }, (_, i) => url(`https://e.com/p/${i}`, "<lastmod>2026-11-24</lastmod>")).join("");
    const started = performance.now();
    const r = lintSitemap(urlset(body).replaceAll("\n", ""));
    const ms = performance.now() - started;
    assert.equal(r.entryCount, MAX_ENTRIES);
    assert.ok(ms < 5000, `took ${Math.round(ms)} ms`);
  });
});
