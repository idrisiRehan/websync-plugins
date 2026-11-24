import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { lintMetadata, type MetadataResult, type RuleId } from "../src/lint.ts";

const TITLE = "Trail Running Shoes for Wet Ground | Example";
const DESCRIPTION = "Compare trail running shoes for mud and wet rock: grip, drop, weight and fit, with sizing advice and free returns within 30 days.";
const URL_ = "https://example.com/shoes/";

// A page with no findings. Tests change one thing and expect exactly the matching findings.
const CLEAN = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${TITLE}</title>
<meta name="description" content="${DESCRIPTION}">
<link rel="canonical" href="${URL_}">
<meta property="og:title" content="Trail shoes">
<meta property="og:type" content="website">
<meta property="og:image" content="https://example.com/a.jpg">
<meta property="og:url" content="${URL_}">
</head>
<body>
<h1>Trail shoes</h1>
<h2>Grip</h2>
</body>
</html>`;

function edit(from: string, to: string, html = CLEAN): string {
  assert.ok(html.includes(from), `fixture does not contain ${from}`);
  return html.replace(from, to);
}

const rules = (result: MetadataResult): RuleId[] => result.findings.map((f) => f.rule);

function only(result: MetadataResult, rule: RuleId) {
  assert.deepEqual(rules(result), [rule], JSON.stringify(result.findings, null, 1));
  return result.findings[0];
}

describe("a clean page", () => {
  test("has no findings and is valid", () => {
    const r = lintMetadata(CLEAN);
    assert.deepEqual(r.findings, []);
    assert.equal(r.valid, true);
    assert.equal(r.errorCount, 0);
    assert.equal(r.warningCount, 0);
  });

  test("stays clean with the page URL given", () => {
    assert.deepEqual(lintMetadata(CLEAN, { url: URL_ }).findings, []);
  });
});

describe("document", () => {
  test("doctype-missing, also when the doctype comes after an element", () => {
    assert.equal(only(lintMetadata(edit("<!DOCTYPE html>\n", "")), "doctype-missing").severity, "warning");
    only(lintMetadata(edit("<!DOCTYPE html>\n<html lang=\"en\">", '<html lang="en"><!DOCTYPE html>')), "doctype-missing");
  });

  test("doctype-legacy for HTML 4 and XHTML doctypes, not for about:legacy-compat", () => {
    const html4 = edit("<!DOCTYPE html>", '<!DOCTYPE HTML PUBLIC "-//W3C//DTD HTML 4.01 Transitional//EN">');
    assert.equal(only(lintMetadata(html4), "doctype-legacy").line, 1);
    assert.deepEqual(lintMetadata(edit("<!DOCTYPE html>", "<!doctype HTML>")).findings, []);
    assert.deepEqual(lintMetadata(edit("<!DOCTYPE html>", '<!DOCTYPE html SYSTEM "about:legacy-compat">')).findings, []);
  });

  test("lang-missing for no attribute, an empty one, or no <html> tag", () => {
    assert.equal(only(lintMetadata(edit(' lang="en"', "")), "lang-missing").line, 2);
    only(lintMetadata(edit('lang="en"', 'lang=" "')), "lang-missing");
    assert.equal(only(lintMetadata(edit('<html lang="en">\n', "")), "lang-missing").line, null);
  });

  test("lang-invalid for underscores and words; valid BCP 47 tags pass", () => {
    for (const bad of ["en_US", "english", "e", "en-"]) only(lintMetadata(edit('lang="en"', `lang="${bad}"`)), "lang-invalid");
    for (const good of ["en-US", "zh-Hant-TW", "pt-BR", "es-419", "x-klingon", "sgn-BE-FR"]) {
      assert.deepEqual(lintMetadata(edit('lang="en"', `lang="${good}"`)).findings, [], good);
    }
  });

  test("charset-missing, unless http-equiv declares it or a byte order mark is present", () => {
    const none = edit('<meta charset="utf-8">\n', "");
    assert.equal(only(lintMetadata(none), "charset-missing").severity, "warning");
    assert.deepEqual(lintMetadata(`﻿${none}`).findings, []);
    const httpEquiv = edit('<meta charset="utf-8">', '<meta http-equiv="Content-Type" content="text/html; charset=UTF-8">');
    assert.deepEqual(lintMetadata(httpEquiv).findings, []);
    assert.equal(lintMetadata(httpEquiv).metadata.charset, "UTF-8");
  });

  test("charset-not-utf8; utf8 without the hyphen is accepted", () => {
    assert.equal(only(lintMetadata(edit('charset="utf-8"', 'charset="windows-1252"')), "charset-not-utf8").line, 4);
    only(lintMetadata(edit('<meta charset="utf-8">', '<meta http-equiv="content-type" content="text/html; charset=iso-8859-1">')), "charset-not-utf8");
    assert.deepEqual(lintMetadata(edit('charset="utf-8"', 'charset="UTF8"')).findings, []);
  });

  test("charset-late when the declaration ends after the first 1024 bytes", () => {
    const padding = `<meta name="keywords" content="${"x".repeat(1000)}">\n`;
    const late = edit('<meta charset="utf-8">', `${padding}<meta charset="utf-8">`);
    assert.equal(only(lintMetadata(late), "charset-late").line, 5);
  });

  test("charset-late counts bytes, not characters, and needs the whole tag inside the limit", () => {
    const fill = (n: number) => `<!DOCTYPE html><html lang="en"><head><!--${"é".repeat(n)}--><meta charset="utf-8">`;
    // 52 bytes of markup around the comment content; each e-acute is 2 bytes.
    const prefix = new TextEncoder().encode(fill(0)).length;
    const fits = Math.floor((1024 - prefix) / 2);
    const rest = `<meta name="viewport" content="width=device-width"><title>${TITLE}</title></head><body><h1>x</h1></body></html>`;
    const result = (n: number) => lintMetadata(fill(n) + rest).findings.filter((f) => f.rule.startsWith("charset"));
    assert.deepEqual(result(fits), []);
    assert.deepEqual(result(fits + 1).map((f) => f.rule), ["charset-late"]);
  });

  test("viewport-missing", () => {
    assert.equal(only(lintMetadata(edit('<meta name="viewport" content="width=device-width, initial-scale=1">\n', "")), "viewport-missing").severity, "warning");
  });
});

describe("title", () => {
  test("title-missing is an error", () => {
    const r = lintMetadata(edit(`<title>${TITLE}</title>\n`, ""));
    assert.equal(only(r, "title-missing").severity, "error");
    assert.equal(r.valid, false);
  });

  test("title-empty for empty and whitespace-only titles", () => {
    assert.equal(only(lintMetadata(edit(TITLE, "")), "title-empty").severity, "error");
    only(lintMetadata(edit(TITLE, " \n\t ")), "title-empty");
  });

  test("title-multiple warns and points at the second title", () => {
    const f = only(lintMetadata(edit("</head>", "<title>Another title for the same page here</title>\n</head>")), "title-multiple");
    assert.equal(f.severity, "warning");
    assert.equal(f.line, 13);
    assert.match(f.message, /first \(line 6\)/);
  });

  test("length warnings say truncation is by pixel width", () => {
    const short = only(lintMetadata(edit(TITLE, "Shoes")), "title-too-short");
    assert.equal(short.severity, "warning");
    assert.match(short.message, /5 characters.*pixel width.*approximate/);
    const long = only(lintMetadata(edit(TITLE, "x".repeat(61))), "title-too-long");
    assert.match(long.message, /61 characters.*pixel width/);
  });

  test("length bounds are inclusive and count code points after collapsing whitespace", () => {
    assert.deepEqual(lintMetadata(edit(TITLE, "x".repeat(30))).findings, []);
    assert.deepEqual(lintMetadata(edit(TITLE, "x".repeat(60))).findings, []);
    assert.deepEqual(lintMetadata(edit(TITLE, "\u{1F45F}".repeat(30))).findings, []);
    only(lintMetadata(edit(TITLE, `  ${"x".repeat(14)}\n\n   ${"y".repeat(14)}  `)), "title-too-short");
  });

  test("an SVG <title> is not the page title", () => {
    const r = lintMetadata(edit("<h1>Trail shoes</h1>", "<svg><title>Logo</title></svg><h1>Trail shoes</h1>"));
    assert.deepEqual(r.findings, []);
    assert.equal(r.metadata.title, TITLE);
  });
});

describe("description", () => {
  test("missing and empty descriptions are warnings", () => {
    assert.equal(only(lintMetadata(edit(`<meta name="description" content="${DESCRIPTION}">\n`, "")), "description-missing").severity, "warning");
    assert.equal(only(lintMetadata(edit(DESCRIPTION, " ")), "description-empty").severity, "warning");
    only(lintMetadata(edit(`content="${DESCRIPTION}"`, "")), "description-empty");
  });

  test("description-multiple", () => {
    const f = only(lintMetadata(edit("</head>", '<meta name="Description" content="Second">\n</head>')), "description-multiple");
    assert.equal(f.line, 13);
  });

  test("length guidance at 120 and 160 characters", () => {
    assert.match(only(lintMetadata(edit(DESCRIPTION, "x".repeat(119))), "description-too-short").message, /119 characters.*pixel width/);
    assert.match(only(lintMetadata(edit(DESCRIPTION, "x".repeat(161))), "description-too-long").message, /161 characters/);
    assert.deepEqual(lintMetadata(edit(DESCRIPTION, "x".repeat(120))).findings, []);
    assert.deepEqual(lintMetadata(edit(DESCRIPTION, "x".repeat(160))).findings, []);
  });
});

describe("canonical", () => {
  test("canonical-missing is a warning", () => {
    assert.equal(only(lintMetadata(edit(`<link rel="canonical" href="${URL_}">\n`, "")), "canonical-missing").severity, "warning");
  });

  test("canonical-multiple only when the targets differ", () => {
    const f = only(lintMetadata(edit("</head>", '<link rel="canonical" href="https://example.com/other/">\n</head>')), "canonical-multiple");
    assert.equal(f.severity, "error");
    assert.match(f.message, /line 8/);
    assert.deepEqual(lintMetadata(edit("</head>", `<link rel="canonical" href="${URL_}">\n</head>`)).findings, []);
  });

  test("a relative canonical that resolves to the same URL doesn't conflict", () => {
    const html = edit("</head>", '<link rel="canonical" href="/shoes/">\n</head>');
    assert.deepEqual(rules(lintMetadata(html, { url: "https://example.com/shoes/?ref=x" })), ["canonical-relative"]);
  });

  test("canonical-invalid for no href, another scheme or a broken URL", () => {
    for (const bad of ["", "javascript:void(0)", "https://exa mple.com/", "mailto:a@example.com"]) {
      const f = only(lintMetadata(edit(`href="${URL_}">\n<meta property="og:title"`, `href="${bad}">\n<meta property="og:title"`)), "canonical-invalid");
      assert.equal(f.severity, "error");
    }
  });

  test("canonical-relative is a warning and resolves with the page URL", () => {
    const html = edit(`<link rel="canonical" href="${URL_}">`, '<link rel="canonical" href="/shoes/">');
    assert.equal(only(lintMetadata(html), "canonical-relative").severity, "warning");
    const r = lintMetadata(html, { url: "https://example.com/shoes/?utm_source=x" });
    assert.deepEqual(rules(r), ["canonical-relative"]);
    assert.equal(r.metadata.canonical, URL_);
  });

  test("relative URLs resolve against <base href>", () => {
    const html = edit(`<link rel="canonical" href="${URL_}">`, '<base href="https://example.com/shoes/x/"><link rel="canonical" href="../">');
    const r = lintMetadata(html, { url: "https://other.example/" });
    assert.equal(r.metadata.canonical, URL_);
  });

  test("canonical-outside-head is an error and names what closed the head", () => {
    const html = edit("<h1>", `<link rel="canonical" href="${URL_}"><h1>`, edit(`<link rel="canonical" href="${URL_}">\n`, ""));
    const f = only(lintMetadata(html), "canonical-outside-head");
    assert.equal(f.severity, "error");
    const implicit = edit("<title>", `<img src="x.png" alt="">\n<title>`);
    const r = lintMetadata(implicit);
    const canonical = r.findings.find((x) => x.rule === "canonical-outside-head")!;
    assert.match(canonical.message, /head ended at <img> on line 6/);
  });

  test("og-url-mismatch when og:url and the canonical differ", () => {
    const f = only(lintMetadata(edit(`<meta property="og:url" content="${URL_}">`, '<meta property="og:url" content="https://example.com/shoes">')), "og-url-mismatch");
    assert.equal(f.severity, "warning");
    assert.equal(f.line, 12);
  });
});

describe("robots", () => {
  const withRobots = (meta: string) => edit("</head>", `${meta}\n</head>`);

  test("index, follow and the Google directives are understood", () => {
    const meta = '<meta name="robots" content="index, follow, max-snippet:-1, max-image-preview:large, max-video-preview:30, noarchive, notranslate, unavailable_after: 2027-01-01">';
    const r = lintMetadata(withRobots(meta));
    assert.deepEqual(r.findings, []);
    assert.deepEqual(r.metadata.robots.robots, ["index", "follow", "max-snippet:-1", "max-image-preview:large", "max-video-preview:30", "noarchive", "notranslate", "unavailable_after: 2027-01-01"]);
  });

  test("robots-noindex for noindex and none, naming the crawler", () => {
    assert.match(only(lintMetadata(withRobots('<meta name="robots" content="NOINDEX">')), "robots-noindex").message, /all search engines/);
    assert.match(only(lintMetadata(withRobots('<meta name="googlebot" content="none">')), "robots-noindex").message, /googlebot/);
    assert.deepEqual(lintMetadata(withRobots('<meta name="robots" content="nofollow">')).findings, []);
  });

  test("robots-directive-unknown for unknown names and bad values", () => {
    const r = lintMetadata(withRobots('<meta name="robots" content="noodp, max-snippet:abc, max-image-preview:huge, unavailable_after:">'));
    assert.deepEqual(rules(r), ["robots-directive-unknown", "robots-directive-unknown", "robots-directive-unknown", "robots-directive-unknown"]);
    assert.match(r.findings[0].message, /"noodp" is not a known directive/);
    assert.match(r.findings[1].message, /"max-snippet:abc" has an invalid value/);
  });

  test("an RFC 850 unavailable_after date keeps its comma", () => {
    const r = lintMetadata(withRobots('<meta name="robots" content="unavailable_after: Wednesday, 15-Nov-27 15:00:00 PST, noarchive">'));
    assert.deepEqual(r.findings, []);
    assert.deepEqual(r.metadata.robots.robots, ["unavailable_after: wednesday, 15-nov-27 15:00:00 pst", "noarchive"]);
  });

  test("robots-googlebot when googlebot tries to lift a robots restriction", () => {
    const r = lintMetadata(withRobots('<meta name="robots" content="nofollow">\n<meta name="googlebot" content="follow">'));
    const f = only(r, "robots-googlebot");
    assert.equal(f.line, 14);
    assert.match(f.message, /most restrictive/);
    assert.deepEqual(lintMetadata(withRobots('<meta name="robots" content="index">\n<meta name="googlebot" content="nosnippet">')).findings, []);
  });
});

describe("Open Graph and X", () => {
  test("og-missing lists the missing required properties", () => {
    const html = edit('<meta property="og:type" content="website">\n', "");
    assert.match(only(lintMetadata(html), "og-missing").message, /property: og:type\.$/);
    const empty = edit('content="Trail shoes">', 'content="">');
    assert.match(only(lintMetadata(empty), "og-missing").message, /og:title/);
  });

  test("og-missing says so when there are no Open Graph tags at all", () => {
    const html = CLEAN.replace(/<meta property="og:[^>]+>\n/g, "");
    assert.match(only(lintMetadata(html), "og-missing").message, /No Open Graph tags/);
  });

  test("og:* in a name attribute is accepted", () => {
    assert.deepEqual(lintMetadata(edit('property="og:type"', 'name="og:type"')).findings, []);
  });

  test("og-image-invalid and og-url-invalid for relative or non-http URLs", () => {
    assert.equal(only(lintMetadata(edit("https://example.com/a.jpg", "/a.jpg")), "og-image-invalid").severity, "error");
    only(lintMetadata(edit("https://example.com/a.jpg", "data:image/png;base64,AAAA")), "og-image-invalid");
    const r = lintMetadata(edit(`<meta property="og:url" content="${URL_}">`, '<meta property="og:url" content="/shoes/">'));
    assert.deepEqual(rules(r), ["og-url-invalid"]);
    assert.equal(r.findings[0].line, 12);
  });

  test("twitter-card-invalid; allowed values pass in any case", () => {
    const withCard = (value: string) => edit("</head>", `<meta name="twitter:card" content="${value}">\n</head>`);
    assert.equal(only(lintMetadata(withCard("large")), "twitter-card-invalid").severity, "error");
    only(lintMetadata(withCard("")), "twitter-card-invalid");
    for (const value of ["summary", "summary_large_image", "app", "player", "Summary"]) {
      assert.deepEqual(lintMetadata(withCard(value)).findings, [], value);
    }
  });
});

describe("headings", () => {
  test("h1-missing is a warning", () => {
    assert.equal(only(lintMetadata(edit("<h1>Trail shoes</h1>\n<h2>Grip</h2>", "<h2>Grip</h2>")), "h1-missing").severity, "warning");
  });

  test("h1-multiple is a warning at the second h1", () => {
    const f = only(lintMetadata(edit("<h2>Grip</h2>", "<h2>Grip</h2>\n<h1>Again</h1>")), "h1-multiple");
    assert.equal(f.severity, "warning");
    assert.equal(f.line, 17);
  });

  test("heading-skipped only for a jump down of more than one level", () => {
    const f = only(lintMetadata(edit("<h2>Grip</h2>", "<h3>Grip</h3>")), "heading-skipped");
    assert.match(f.message, /<h3> follows <h1> \(line 15\)/);
    assert.deepEqual(lintMetadata(edit("<h2>Grip</h2>", "<h2>Grip</h2><h3>a</h3><h4>b</h4><h2>c</h2>")).findings, []);
  });

  test("headings inside <template> don't count", () => {
    assert.deepEqual(lintMetadata(edit("<h2>Grip</h2>", "<template><h1>x</h1><h4>y</h4></template><h2>Grip</h2>")).findings, []);
  });
});

describe("hreflang", () => {
  const alternates = (...links: string[]) => edit("</head>", `${links.join("\n")}\n</head>`);
  const link = (code: string, href: string) => `<link rel="alternate" hreflang="${code}" href="${href}">`;

  test("a complete set passes", () => {
    const r = lintMetadata(alternates(link("en", URL_), link("de-DE", "https://example.com/de/"), link("zh-Hant", "https://example.com/zh/"), link("pt-br", "https://example.com/pt/"), link("x-default", URL_)));
    assert.deepEqual(r.findings, []);
    assert.equal(r.metadata.hreflang.length, 5);
  });

  test("hreflang-invalid for underscores, unknown shapes and the UK region", () => {
    // Google supports only ISO 639-1 languages and ISO 3166-1 alpha-2 regions, so not es-419 or fil.
    for (const code of ["en_US", "english", "en-USA", "", "x-def", "es-419", "fil", "fil-PH"]) {
      const r = lintMetadata(alternates(link(code, "https://example.com/x/"), link("en", URL_), link("x-default", URL_)));
      assert.deepEqual(rules(r), ["hreflang-invalid"], code);
      assert.equal(r.findings[0].severity, "error");
    }
    const uk = lintMetadata(alternates(link("en-UK", URL_), link("x-default", URL_)));
    assert.match(only(uk, "hreflang-invalid").message, /Use GB/);
    const eu = lintMetadata(alternates(link("en-EU", "https://example.com/eu/"), link("en", URL_), link("x-default", URL_)));
    assert.match(only(eu, "hreflang-invalid").message, /EU is a reserved code/);
  });

  test("hreflang-href-invalid for relative and broken hrefs", () => {
    const r = lintMetadata(alternates(link("en", URL_), link("de", "/de/"), link("fr", "ftp://example.com/fr/"), link("x-default", URL_)));
    assert.deepEqual(rules(r), ["hreflang-href-invalid", "hreflang-href-invalid"]);
    assert.match(r.findings[0].message, /relative. Google requires fully qualified/);
    assert.match(r.findings[1].message, /not a valid http\(s\) URL/);
  });

  test("hreflang-duplicate when one code points to two URLs", () => {
    const r = lintMetadata(alternates(link("en", URL_), link("EN", "https://example.com/en/"), link("x-default", URL_)));
    assert.equal(only(r, "hreflang-duplicate").severity, "error");
    assert.deepEqual(lintMetadata(alternates(link("en", URL_), link("en", URL_), link("x-default", URL_))).findings, []);
  });

  test("hreflang-x-default-missing", () => {
    assert.equal(only(lintMetadata(alternates(link("en", URL_), link("de", "https://example.com/de/"))), "hreflang-x-default-missing").severity, "warning");
  });

  test("hreflang-self-missing ignores a fragment in the page URL", () => {
    const html = edit(`<link rel="canonical" href="${URL_}">\n`, "", alternates(link("en", URL_), link("x-default", URL_)));
    assert.deepEqual(rules(lintMetadata(html, { url: `${URL_}#reviews` })), ["canonical-missing"]);
  });

  test("hreflang-self-missing compares against the page URL and the canonical", () => {
    const html = alternates(link("de", "https://example.com/de/"), link("x-default", "https://example.com/de/"));
    assert.equal(only(lintMetadata(html), "hreflang-self-missing").line, 13);
    const noCanonical = edit(`<link rel="canonical" href="${URL_}">\n`, "", html);
    assert.deepEqual(rules(lintMetadata(noCanonical)), ["canonical-missing"]);
    assert.deepEqual(rules(lintMetadata(noCanonical, { url: URL_ })), ["canonical-missing", "hreflang-self-missing"]);
  });
});

describe("placement", () => {
  test("metadata-in-body names the element and what ended the head", () => {
    const html = edit('<meta name="viewport"', '<p>Hello there, visitor</p>\n<meta name="viewport"');
    const r = lintMetadata(html);
    assert.ok(rules(r).every((rule) => rule === "metadata-in-body" || rule === "canonical-outside-head"));
    const viewport = r.findings.find((f) => f.message.startsWith('<meta name="viewport">'))!;
    assert.equal(viewport.severity, "error");
    assert.match(viewport.message, /head ended at <p> on line 5/);
  });

  test("text in the head closes it", () => {
    const r = lintMetadata(edit("<title>", "Stray text\n<title>"));
    assert.match(r.findings[0].message, /head ended at text "Stray text" on line 6/);
    assert.equal(r.findings[0].rule, "metadata-in-body");
  });

  test("microdata meta, body-ok links, scripts and noscript pixels don't close or break the head", () => {
    const html = edit(
      "<title>",
      '<script>if (a < b) document.write("<p>")</script>\n<noscript><img src="https://t.example/p.gif" alt=""></noscript>\n<title>',
      edit("<h2>Grip</h2>", '<h2>Grip</h2>\n<meta itemprop="price" content="10"><link rel="stylesheet preload" href="/x.css"><link itemprop="url" href="/x">'),
    );
    assert.deepEqual(lintMetadata(html).findings, []);
  });

  test("RDFa meta in body is allowed, but Open Graph in body is not", () => {
    const rdfa = edit("<h2>Grip</h2>", '<h2>Grip</h2>\n<ol vocab="https://schema.org/" typeof="BreadcrumbList"><li property="itemListElement" typeof="ListItem"><meta property="position" content="1"></li></ol>');
    assert.deepEqual(lintMetadata(rdfa).findings, []);
    const og = edit("<h2>Grip</h2>", '<h2>Grip</h2>\n<meta property="og:locale" content="en_GB">');
    assert.equal(only(lintMetadata(og), "metadata-in-body").line, 17);
  });

  test("elements after an explicit </head> but before <body> still belong to the head", () => {
    assert.deepEqual(lintMetadata(edit("</head>\n<body>", '</head>\n<meta name="author" content="A">\n<body>')).findings, []);
  });

  test("meta-duplicate for repeated names, but not theme-color, verification tokens or og arrays", () => {
    const html = edit("</head>", '<meta name="viewport" content="width=device-width">\n<meta name="viewport" content="x">\n</head>');
    const f = only(lintMetadata(html), "meta-duplicate");
    assert.equal(f.line, 13);
    assert.match(f.message, /first on line 5/);
    const repeatable = edit(
      "</head>",
      '<meta name="theme-color" content="#fff" media="(prefers-color-scheme: light)"><meta name="theme-color" content="#000">\n<meta name="google-site-verification" content="a"><meta name="google-site-verification" content="b">\n<meta property="og:image" content="https://example.com/b.jpg">\n</head>',
    );
    assert.deepEqual(lintMetadata(repeatable).findings, []);
    // Google combines repeated robots tags, so they aren't duplicates.
    const robots = edit("</head>", '<meta name="robots" content="index, follow">\n<meta name="robots" content="max-image-preview:large">\n</head>');
    assert.deepEqual(lintMetadata(robots).findings, []);
  });
});

describe("result shape", () => {
  test("findings without a line come first, then in line order", () => {
    const html = edit(`<title>${TITLE}</title>`, "<title>Short</title>", edit("<!DOCTYPE html>\n", ""));
    const r = lintMetadata(html);
    assert.deepEqual(rules(r), ["doctype-missing", "title-too-short"]);
    assert.deepEqual(r.findings.map((f) => f.line), [null, 5]);
  });

  test("an invalid options.url throws a TypeError", () => {
    assert.throws(() => lintMetadata(CLEAN, { url: "/relative" }), TypeError);
    assert.throws(() => lintMetadata(CLEAN, { url: "ftp://example.com/" }), TypeError);
  });

  test("any input lints without throwing", () => {
    for (const input of ["", "   ", "<", "<html", "just text", "<title>", "<svg><title>", "<meta charset=>"]) lintMetadata(input);
    const empty = lintMetadata("");
    assert.deepEqual(rules(empty), ["doctype-missing", "lang-missing", "charset-missing", "viewport-missing", "title-missing", "description-missing", "canonical-missing", "og-missing", "h1-missing"]);
    assert.equal(empty.valid, false);
  });
});
