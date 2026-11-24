import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { lintMetadata } from "../src/lint.ts";
import { scanPage } from "../src/scan.ts";

describe("metadata summary", () => {
  const html = `<!doctype html>
<html lang="de-DE">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width">
<title>  Laufschuhe   &amp;
 Trail  </title>
<meta name="description" content="  Schuhe f&uuml;r  nasse Wege ">
<link rel="Canonical" href="/de/">
<meta name="robots" content="noindex">
<meta name="robots" content="nofollow">
<meta name="googlebot" content="nosnippet">
<meta property="og:title" content="A">
<meta property="og:image" content="https://example.com/1.jpg">
<meta property="og:image" content="https://example.com/2.jpg">
<meta property="article:published_time" content="2026-11-24">
<meta name="twitter:card" content="summary">
<meta property="twitter:site" content="@example">
<link rel="alternate" hreflang="en" href="/en/">
<link rel="alternate" hreflang="x-default" href="https://example.com/">
</head>
<body><h1>Hallo <em>Welt</em></h1><h2><img src="a.png" alt="Logo"> Teil</h2></body>
</html>`;
  const { metadata } = lintMetadata(html, { url: "https://example.com/de/seite" });

  test("title and description are decoded and whitespace-collapsed", () => {
    assert.equal(metadata.title, "Laufschuhe & Trail");
    // &uuml; is not in the tokenizer's short entity table, so it stays as written.
    assert.equal(metadata.description, "Schuhe f&uuml;r nasse Wege");
  });

  test("lang, charset, viewport and canonical (resolved)", () => {
    assert.equal(metadata.lang, "de-DE");
    assert.equal(metadata.charset, "UTF-8");
    assert.equal(metadata.viewport, "width=device-width");
    assert.equal(metadata.canonical, "https://example.com/de/");
  });

  test("robots directives are merged per name", () => {
    assert.deepEqual(metadata.robots, { robots: ["noindex", "nofollow"], googlebot: ["nosnippet"] });
  });

  test("openGraph and twitter keep the first value of each property", () => {
    assert.deepEqual(metadata.openGraph, { "og:title": "A", "og:image": "https://example.com/1.jpg", "article:published_time": "2026-11-24" });
    assert.deepEqual(metadata.twitter, { "twitter:card": "summary", "twitter:site": "@example" });
  });

  test("hreflang alternates with resolved hrefs and lines", () => {
    assert.deepEqual(metadata.hreflang, [
      { hreflang: "en", href: "https://example.com/en/", line: 19 },
      { hreflang: "x-default", href: "https://example.com/", line: 20 },
    ]);
  });

  test("headings include inline text and image alt text", () => {
    assert.deepEqual(metadata.headings, [
      { level: 1, text: "Hallo Welt", line: 22 },
      { level: 2, text: "Logo Teil", line: 22 },
    ]);
  });

  test("an empty page has an empty summary", () => {
    assert.deepEqual(lintMetadata("").metadata, {
      title: null, description: null, canonical: null, robots: {}, lang: null, charset: null, viewport: null,
      openGraph: {}, twitter: {}, hreflang: [], headings: [],
    });
  });

  test("the summary is plain JSON", () => {
    assert.deepEqual(JSON.parse(JSON.stringify(metadata)), { ...metadata, robots: { ...metadata.robots } });
  });
});

describe("head and body placement", () => {
  const placement = (html: string) => {
    const page = scanPage(html);
    return [...page.titles, ...page.metas, ...page.links].sort((a, b) => a.line - b.line).map((el) => `${el.tag}:${el.inHead ? "head" : "body"}`);
  };

  test("metadata before any <head> tag opens the head implicitly", () => {
    assert.deepEqual(placement("<title>x</title>\n<meta name=a>"), ["title:head", "meta:head"]);
    assert.equal(scanPage("<title>x</title>").headClosedBy, null);
  });

  test("the first non-head start tag ends the head", () => {
    const page = scanPage("<head>\n<meta name=a>\n<div>\n<meta name=b>");
    assert.deepEqual(placement("<head>\n<meta name=a>\n<div>\n<meta name=b>"), ["meta:head", "meta:body"]);
    assert.deepEqual(page.headClosedBy, { what: "<div>", line: 3 });
  });

  test("whitespace text keeps the head open; other text ends it", () => {
    assert.deepEqual(placement("<head>\n  \n<meta name=a>"), ["meta:head"]);
    const page = scanPage("<head>\n&nbsp;\n<meta name=a>");
    assert.equal(page.metas[0].inHead, false);
    assert.match(page.headClosedBy!.what, /^text/);
  });

  test("an explicit <body> ends the head without being reported as implicit", () => {
    const page = scanPage("<head><title>x</title></head><body><meta name=a>");
    assert.equal(page.metas[0].inHead, false);
    assert.equal(page.headClosedBy, null);
  });

  test("between </head> and <body>, metadata still goes into the head", () => {
    assert.deepEqual(placement("<head></head>\n<link rel=canonical href=/>\n<body>\n<meta name=a>"), ["link:head", "meta:body"]);
  });

  test("<noscript> after </head> opens the body; it doesn't go back into the head", () => {
    const page = scanPage("<head></head>\n<noscript><img src=p.gif></noscript>\n<meta name=a>\n<body>");
    assert.deepEqual(page.metas.map((m) => m.inHead), [false]);
  });

  test("</body>, </html> and </br> before the body end the head", () => {
    for (const end of ["</body>", "</html>", "</br>"]) {
      const page = scanPage(`<head><meta name=a>\n${end}\n<meta name=b>`);
      assert.deepEqual(page.metas.map((m) => m.inHead), [true, false], end);
      assert.deepEqual(page.headClosedBy, { what: end, line: 2 });
    }
  });

  test("a later <head> tag in the body doesn't reopen the head", () => {
    assert.deepEqual(placement("<p>x</p><head><meta name=a>"), ["meta:body"]);
  });

  test("script and style content never ends the head", () => {
    assert.deepEqual(placement("<head><script>document.write('<div>text')</script><style>p{}</style><meta name=a>"), ["meta:head"]);
  });

  test("noscript and template content is skipped, including nested templates", () => {
    const page = scanPage("<head><noscript><img src=p.gif><meta name=a></noscript><template><template><title>t</title></template><div></div></template><meta name=b>");
    assert.deepEqual(page.metas.map((m) => [m.attrs.name, m.inHead]), [["b", true]]);
    assert.deepEqual(page.titles, []);
  });

  test("self-closing <svg/> doesn't swallow what follows", () => {
    const page = scanPage("<body><svg/><h1>x</h1><svg><title>tip</title><text>label</text></svg><h2>y</h2>");
    assert.deepEqual(page.headings.map((h) => h.text), ["x", "y"]);
    assert.deepEqual(page.titles, []);
  });

  test("an HTML tag like <h2> or <p> ends unclosed <svg> or <math>, as in browsers", () => {
    const page = scanPage("<body><svg><path d=M0><h2>a</h2><math><mi>x</mi><p>b</p><h3>c</h3>");
    assert.deepEqual(page.headings.map((h) => h.text), ["a", "c"]);
    // A <meta> breaks out too, so it is still found (in the body).
    assert.deepEqual(scanPage("<body><svg><g><meta name=description content=d>").metas.map((m) => [m.attrs.name, m.inHead]), [["description", false]]);
  });

  test("<font> breaks out of <svg> only with color, face or size", () => {
    assert.deepEqual(scanPage("<body><svg><font><h1>a</h1></svg>").headings.map((h) => h.text), ["a"]);
    // A <title> after the break is an HTML title; inside the <svg> it is an SVG tooltip.
    assert.equal(scanPage("<body><svg><font size=2></font><title>t</title>").titles.length, 1);
    assert.equal(scanPage("<body><svg><font></font><title>tip</title></svg>").titles.length, 0);
  });

  test("HTML inside <foreignObject> or a MathML <mi> stays in the foreign content", () => {
    const page = scanPage("<body><svg><foreignObject><div><h1>in</h1></div></foreignObject><title>tip</title></svg><math><mi><b>x</b></mi></math><h2>out</h2>");
    assert.deepEqual(page.headings.map((h) => h.text), ["out"]);
    assert.deepEqual(page.titles, []);
  });

  test("a heading start tag closes an open heading", () => {
    assert.deepEqual(scanPage("<h1>a<h2>b</h2>").headings.map((h) => [h.level, h.text]), [[1, "a"], [2, "b"]]);
  });

  test("an unclosed title at the end of input is still collected", () => {
    assert.equal(lintMetadata("<title>Half a title").metadata.title, "Half a title");
  });

  test("only a doctype before any content counts", () => {
    assert.deepEqual(scanPage("<!-- c -->\n<!DOCTYPE html><html>").doctype, { value: "html", line: 2 });
    assert.equal(scanPage("<html><!DOCTYPE html>").doctype, null);
  });
});
