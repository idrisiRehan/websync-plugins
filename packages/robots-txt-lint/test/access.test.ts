import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { aiCrawlerReport, isAllowed } from "../src/access.ts";
import { AI_CRAWLERS } from "../src/ai-crawlers.ts";
import { lintRobotsTxt } from "../src/lint.ts";

const allowed = (robots: string, agent: string, path: string) => isAllowed(robots, agent, path).allowed;

function check(robots: string, agent: string, cases: Record<string, boolean>) {
  for (const [path, expected] of Object.entries(cases)) {
    assert.equal(allowed(robots, agent, path), expected, `${agent} ${path}`);
  }
}

// RFC 9309 s5.1.
const RFC_SIMPLE = `User-Agent: *
Disallow: *.gif$
Disallow: /example/
Allow: /publications/

User-Agent: foobot
Disallow:/
Allow:/example/page.html
Allow:/example/allowed.gif

User-Agent: barbot
User-Agent: bazbot
Disallow: /example/page.html

User-Agent: quxbot
`;

describe("RFC 9309 examples", () => {
  test("s5.1: the * group", () => {
    check(RFC_SIMPLE, "ExampleBot", {
      "/": true,
      "/example/": false,
      "/example/page.html": false,
      "/images/logo.gif": false,
      "/images/logo.gif?v=2": true,
      "/publications/": true,
      "/publications/cover.gif": true,
    });
  });

  test("s5.1: foobot may fetch only two paths", () => {
    check(RFC_SIMPLE, "foobot", { "/": false, "/example/page.html": true, "/example/allowed.gif": true, "/example/other.html": false });
  });

  test("s5.1: barbot and bazbot share a group and don't fall back to *", () => {
    for (const agent of ["barbot", "bazbot"]) check(RFC_SIMPLE, agent, { "/example/page.html": false, "/example/other.html": true, "/a.gif": true });
  });

  test("s5.1: quxbot's empty group allows everything", () => {
    check(RFC_SIMPLE, "quxbot", { "/": true, "/example/page.html": true });
    assert.deepEqual(isAllowed(RFC_SIMPLE, "quxbot", "/example/"), { allowed: true, rule: null, group: "specific", groupLines: [15], path: "/example/" });
  });

  test("s5.2: the longest match wins", () => {
    const robots = "User-Agent: foobot\nAllow: /example/page/\nDisallow: /example/page/disallowed.gif\n";
    const d = isAllowed(robots, "foobot", "https://example.com/example/page/disallowed.gif");
    assert.equal(d.allowed, false);
    assert.deepEqual(d.rule, { type: "disallow", pattern: "/example/page/disallowed.gif", line: 3 });
    assert.equal(allowed(robots, "foobot", "/example/page/other.gif"), true);
  });

  test("s2.2.1 figure 2: groups for the same agent are merged", () => {
    const robots = "user-agent: ExampleBot\ndisallow: /foo\ndisallow: /bar\n\nuser-agent: ExampleBot\ndisallow: /baz\n";
    check(robots, "ExampleBot", { "/foo": false, "/bar": false, "/baz": false, "/qux": true });
    assert.deepEqual(isAllowed(robots, "ExampleBot", "/baz").groupLines, [1, 5]);
  });

  test("s2.2.1 figure 3: without a matching group, the * group applies", () => {
    const robots = "user-agent: *\ndisallow: /foo\ndisallow: /bar\n\nuser-agent: BazBot\ndisallow: /baz\n";
    check(robots, "ExampleBot", { "/foo": false, "/bar": false, "/baz": true });
    assert.equal(isAllowed(robots, "ExampleBot", "/foo").group, "*");
  });

  test("s2.2.1: product tokens match case-insensitively; no groups means no rules", () => {
    assert.equal(allowed("User-agent: EXAMPLEBOT\nDisallow: /\n", "examplebot", "/a"), false);
    assert.deepEqual(isAllowed("", "ExampleBot", "/a"), { allowed: true, rule: null, group: null, groupLines: [], path: "/a" });
    assert.equal(isAllowed("User-agent: other\nDisallow: /\n", "ExampleBot", "/a").group, null);
  });

  test("s2.2.2: allow wins a tie, and /robots.txt is always allowed", () => {
    assert.deepEqual(isAllowed("User-agent: *\nDisallow: /a\nAllow: /a\n", "*", "/a").rule?.type, "allow");
    assert.deepEqual(isAllowed("User-agent: *\nAllow: /a\nDisallow: /a\n", "*", "/a").rule?.type, "allow");
    check("User-agent: *\nDisallow: /\n", "*", { "/robots.txt": true, "/robots.txt?x": false, "/": false });
  });

  test("s2.2.2 figure 4: percent-encoding is normalised", () => {
    const tsu = String.fromCharCode(0x30c4);
    check(`User-agent: *\nDisallow: /foo/bar/%E3%83%84\n`, "*", { [`/foo/bar/${tsu}`]: false, "/foo/bar/%e3%83%84": false, "/foo/bar/%E3%83%84": false });
    check(`User-agent: *\nDisallow: /foo/bar/${tsu}\n`, "*", { "/foo/bar/%E3%83%84": false });
    check("User-agent: *\nDisallow: /foo/bar/baz\n", "*", { "/foo/bar/%62%61%7A": false, "/foo/bar/%62%61%7a": false });
    check("User-agent: *\nDisallow: /foo/bar?baz=https%3A%2F%2Ffoo.bar\n", "*", { "/foo/bar?baz=https%3a%2f%2ffoo.bar": false });
    // Reserved characters stay encoded: %2F is not a path separator.
    check("User-agent: *\nDisallow: /a/b\n", "*", { "/a%2Fb": true });
  });

  test("s2.2.3 figure 6: a percent-encoded * or $ in a pattern matches the literal character", () => {
    const robots = "User-agent: *\nDisallow: /path/file-with-a-%2A.html\nDisallow: /path/foo-%24\n";
    check(robots, "*", { "https://www.example.com/path/file-with-a-*.html": false, "/path/foo-$": false, "/path/file-with-a-x.html": true });
  });

  test("s2.2.3: * matches any run of characters, $ ends the match", () => {
    check("User-agent: *\nAllow: /this/*/exactly\nDisallow: /\n", "*", { "/this/a/b/exactly": true, "/this/exactly": false });
    check("User-agent: *\nDisallow: /this/path/exactly$\n", "*", { "/this/path/exactly": false, "/this/path/exactly/": true });
    // Only a final $ is special; elsewhere it is a literal $.
    check("User-agent: *\nDisallow: /a$b\n", "*", { "/a$b": false, "/a": true });
  });
});

describe("Google's documented examples", () => {
  // https://developers.google.com/search/docs/crawling-indexing/robots/robots_txt#url-matching-based-on-path-values
  const table: [string, string[], string[]][] = [
    ["/", ["/", "/anything/at/all"], []],
    ["/*", ["/", "/anything"], []],
    ["/$", ["/"], ["/page", "/?q=1"]],
    ["/fish", ["/fish", "/fish.html", "/fish/salmon.html", "/fishheads", "/fishheads/yummy.html", "/fish.php?id=anything"], ["/Fish.asp", "/catfish", "/?id=fish", "/desert/fish"]],
    ["/fish*", ["/fish", "/fish.html", "/fish/salmon.html", "/fishheads", "/fishheads/yummy.html", "/fish.php?id=anything"], ["/Fish.asp", "/catfish", "/?id=fish", "/desert/fish"]],
    ["/fish/", ["/fish/", "/fish/?id=anything", "/fish/salmon.htm"], ["/fish", "/fish.html", "/animals/fish/", "/Fish/Salmon.asp"]],
    ["/*.php", ["/index.php", "/filename.php", "/folder/filename.php", "/folder/filename.php?parameters", "/folder/any.php.file.html", "/filename.php/"], ["/", "/windows.PHP"]],
    ["/*.php$", ["/filename.php", "/folder/filename.php"], ["/filename.php?parameters", "/filename.php/", "/filename.php5", "/windows.PHP"]],
    ["/fish*.php", ["/fish.php", "/fishheads/catfish.php?parameters"], ["/Fish.PHP"]],
  ];
  for (const [pattern, matches, misses] of table) {
    test(`path matching: ${pattern}`, () => {
      const robots = `User-agent: *\nDisallow: ${pattern}\n`;
      for (const path of matches) assert.equal(allowed(robots, "*", path), false, `${pattern} should match ${path}`);
      for (const path of misses) assert.equal(allowed(robots, "*", path), true, `${pattern} should not match ${path}`);
    });
  }

  test("order of precedence for rules", () => {
    const cases: [string, string, "allow" | "disallow"][] = [
      ["https://example.com/page", "allow: /p\ndisallow: /", "allow"],
      ["https://example.com/folder/page", "allow: /folder\ndisallow: /folder", "allow"],
      ["https://example.com/page.htm", "allow: /page\ndisallow: /*.htm", "disallow"],
      ["https://example.com/page.php5", "allow: /page\ndisallow: /*.ph", "allow"],
      ["https://example.com/", "allow: /$\ndisallow: /", "allow"],
      ["https://example.com/page.htm", "allow: /$\ndisallow: /", "disallow"],
    ];
    for (const [url, rules, winner] of cases) {
      assert.equal(isAllowed(`user-agent: *\n${rules}\n`, "Googlebot", url).rule?.type, winner, `${url} with ${rules}`);
    }
  });

  test("order of precedence for user agents", () => {
    const robots = "user-agent: googlebot-news\ndisallow: /1\n\nuser-agent: *\ndisallow: /2\n\nuser-agent: googlebot\ndisallow: /3\n";
    assert.deepEqual(isAllowed(robots, "Googlebot-News", "/1").groupLines, [1]);
    assert.deepEqual(isAllowed(robots, "Googlebot", "/3").groupLines, [7]);
    assert.deepEqual(isAllowed(robots, "Storebot-Google", "/2").groupLines, [4]);
  });

  test("specific and * groups are not combined", () => {
    const robots = "user-agent: googlebot-news\ndisallow: /fish\n\nuser-agent: *\ndisallow: /carrots\n\nuser-agent: googlebot-news\ndisallow: /shrimp\n";
    check(robots, "googlebot-news", { "/fish": false, "/shrimp": false, "/carrots": true });
  });

  test("googlebot/1.2 and googlebot* are equivalent to googlebot", () => {
    for (const value of ["googlebot/1.2", "googlebot*", "Googlebot"]) {
      assert.equal(isAllowed(`User-agent: ${value}\nDisallow: /\n`, "Googlebot", "/a").group, "specific", value);
    }
    assert.equal(isAllowed("User-agent: * all crawlers\nDisallow: /\n", "Googlebot", "/a").group, "*");
    assert.equal(isAllowed("User-agent: *bot\nDisallow: /\n", "Googlebot", "/a").group, null);
  });

  test("a sitemap line between user-agent lines doesn't split the group", () => {
    const robots = "user-agent: a\nsitemap: https://example.com/sitemap.xml\nuser-agent: b\ndisallow: /\n";
    check(robots, "a", { "/x": false });
  });

  test("rules without a path are ignored", () => {
    check("User-agent: *\nDisallow:\nAllow:\n", "*", { "/": true, "/x": true });
  });
});

describe("isAllowed input", () => {
  test("takes text or a lint result, and returns the deciding rule", () => {
    const text = "User-agent: *\nDisallow: /private/\n";
    const fromText = isAllowed(text, "*", "https://example.com/private/a?b=1#frag");
    assert.deepEqual(fromText, { allowed: false, rule: { type: "disallow", pattern: "/private/", line: 2 }, group: "*", groupLines: [1], path: "/private/a?b=1" });
    assert.deepEqual(isAllowed(lintRobotsTxt(text), "*", "/private/a?b=1#frag"), fromText);
  });

  test("throws a TypeError on a bad user agent, URL or robots value", () => {
    assert.throws(() => isAllowed("", "Googlebot/2.1", "/"), TypeError);
    assert.throws(() => isAllowed("", "", "/"), TypeError);
    assert.throws(() => isAllowed("", "*", "relative/path"), TypeError);
    assert.throws(() => isAllowed("", "*", "mailto:a@example.com"), TypeError);
    assert.throws(() => isAllowed({} as never, "*", "/"), TypeError);
  });

  test("a path and a full URL are percent-encoded the same way", () => {
    const robots = "User-agent: *\nDisallow: /a%20b\nDisallow: /c%7Bd%7D\n";
    for (const path of ["/a b", "/c{d}"]) {
      const fromPath = isAllowed(robots, "*", path);
      assert.equal(fromPath.allowed, false, path);
      assert.deepEqual(isAllowed(robots, "*", `https://example.com${path}`), fromPath);
    }
    assert.equal(isAllowed(robots, "*", "//a b").path, "//a%20b");
  });

  test("never throws on odd paths", () => {
    const robots = "User-agent: *\nDisallow: /%\nDisallow: /%zz\nDisallow: /a%\n";
    for (const path of ["/%", "/%zz", "/a%", "/%E3%83", `/${String.fromCharCode(0xd800)}`, "/a b", `/${"*".repeat(1000)}`]) {
      assert.equal(typeof isAllowed(robots, "*", path).allowed, "boolean");
    }
  });

  test("matching stays fast on long patterns and paths", () => {
    const robots = `User-agent: *\nDisallow: /${"*a".repeat(5_000)}b$\n`;
    const start = performance.now();
    assert.equal(allowed(robots, "*", `/${"a".repeat(100_000)}`), true);
    assert.ok(performance.now() - start < 1_000);
  });
});

describe("AI crawlers", () => {
  test("every table entry is complete and sourced", () => {
    const tokens = new Set<string>();
    for (const c of AI_CRAWLERS) {
      assert.match(c.token, /^[A-Za-z_-]+$/, c.token);
      assert.ok(!tokens.has(c.token.toLowerCase()), `duplicate ${c.token}`);
      tokens.add(c.token.toLowerCase());
      assert.ok(c.operator);
      assert.ok(["training", "search", "user", "dataset"].includes(c.purpose), c.token);
      assert.match(c.source, /^https:\/\//, c.token);
      assert.match(c.checked, /^\d{4}-\d{2}-\d{2}$/, c.token);
    }
  });

  test("reports blocked, partial and allowed with the group that applied", () => {
    const robots = "User-agent: *\nDisallow: /admin/\n\nUser-agent: GPTBot\nUser-agent: ClaudeBot\nDisallow: /\n\nUser-agent: PerplexityBot\nDisallow:\n";
    const report = new Map(aiCrawlerReport(robots).map((r) => [r.token, r]));
    assert.equal(report.size, AI_CRAWLERS.length);
    assert.deepEqual([report.get("GPTBot")?.access, report.get("GPTBot")?.group, report.get("GPTBot")?.groupLines], ["blocked", "specific", [4]]);
    assert.deepEqual([report.get("ClaudeBot")?.access, report.get("ClaudeBot")?.group], ["blocked", "specific"]);
    assert.deepEqual([report.get("PerplexityBot")?.access, report.get("PerplexityBot")?.group], ["allowed", "specific"]);
    assert.deepEqual([report.get("CCBot")?.access, report.get("CCBot")?.group, report.get("CCBot")?.groupLines], ["partial", "*", [1]]);
    assert.equal(report.get("GPTBot")?.operator, "OpenAI");
  });

  test("an Allow inside a blocked group makes it partial; no file allows everything", () => {
    const report = aiCrawlerReport("User-agent: CCBot\nDisallow: /\nAllow: /public/\n");
    assert.equal(report.find((r) => r.token === "CCBot")?.access, "partial");
    assert.deepEqual(new Set(aiCrawlerReport("").map((r) => `${r.access} ${r.group}`)), new Set(["allowed null"]));
  });

  test("Disallow: /*$ blocks everything, like Disallow: /", () => {
    for (const pattern of ["/*$", "*$"]) {
      const report = aiCrawlerReport(`User-agent: GPTBot
Disallow: ${pattern}
`);
      assert.equal(report.find((r) => r.token === "GPTBot")?.access, "blocked", pattern);
    }
    const anchored = aiCrawlerReport(`User-agent: GPTBot
Disallow: /$
`);
    assert.equal(anchored.find((r) => r.token === "GPTBot")?.access, "partial");
  });

  test("tokens match case-insensitively", () => {
    const report = aiCrawlerReport("User-agent: META-EXTERNALAGENT\nDisallow: /\n");
    assert.equal(report.find((r) => r.token === "meta-externalagent")?.access, "blocked");
  });
});
