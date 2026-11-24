import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lintRobotsTxt, type RobotsTxtResult, type RuleId } from "../src/lint.ts";

const example = (name: string) => readFileSync(new URL(`../examples/${name}`, import.meta.url), "utf8");

const rules = (result: RobotsTxtResult) => result.findings.map((f) => [f.rule, f.severity, f.line]);

function only(text: string, rule: RuleId) {
  const result = lintRobotsTxt(text);
  assert.equal(result.findings.length, 1, `expected only ${rule}, got: ${JSON.stringify(result.findings)}`);
  assert.equal(result.findings[0].rule, rule);
  return result.findings[0];
}

function clean(text: string) {
  const result = lintRobotsTxt(text);
  assert.deepEqual(result.findings, []);
  return result;
}

// RFC 9309 s5.1, verbatim apart from indentation.
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

EOF
`;

describe("valid files", () => {
  test("the example robots.txt is clean", () => {
    const r = clean(example("robots.txt"));
    assert.equal(r.valid, true);
    assert.equal(r.groups.length, 2);
    assert.deepEqual(r.sitemaps, [{ url: "https://shop.example.com/sitemap.xml", line: 19 }]);
  });

  test("RFC 9309 s5.1 parses into four groups; only its literal EOF line is flagged", () => {
    const r = lintRobotsTxt(RFC_SIMPLE);
    assert.deepEqual(rules(r), [["line-invalid", "error", 17]]);
    assert.deepEqual(
      r.groups.map((g) => [g.agents, g.line, g.rules.length]),
      [
        [["*"], 1, 3],
        [["foobot"], 6, 3],
        [["barbot", "bazbot"], 11, 1],
        [["quxbot"], 15, 0],
      ],
    );
    assert.deepEqual(r.groups[1].rules[0], { type: "disallow", pattern: "/", line: 7 });
  });

  test("an empty file, comments and blank lines are fine", () => {
    assert.deepEqual(clean("").groups, []);
    clean("# nothing to see\n\n   \n");
  });

  test('"Disallow:" with no path allows everything and is not flagged', () => {
    const r = clean("User-agent: *\nDisallow:\n");
    assert.deepEqual(r.groups[0].rules, [{ type: "disallow", pattern: "", line: 2 }]);
  });

  test("field names are case-insensitive, and spaces around the colon are optional", () => {
    const r = clean("USER-AGENT:Googlebot\n  disallow  :  /a   # comment\nSITEMAP: https://example.com/s.xml\n");
    assert.deepEqual(r.groups[0], { agents: ["Googlebot"], line: 1, rules: [{ type: "disallow", pattern: "/a", line: 2 }] });
  });

  test("a byte-order mark, CRLF and CR line endings are accepted", () => {
    const r = clean("\uFEFFUser-agent: *\r\nDisallow: /a\rDisallow: /b\n");
    assert.deepEqual(r.groups[0].rules.map((x) => [x.pattern, x.line]), [["/a", 2], ["/b", 3]]);
  });

  test("Sitemap and unknown lines don't end a group (RFC 9309 s2.2.4)", () => {
    const r = lintRobotsTxt("User-agent: a\nSitemap: https://example.com/s.xml\nUser-agent: b\nDisallow: /\n");
    assert.deepEqual(r.findings, []);
    assert.deepEqual(r.groups.map((g) => g.agents), [["a", "b"]]);
  });

  test("a user-agent line after a rule starts a new group, even an empty rule", () => {
    const r = clean("User-agent: a\nDisallow:\nUser-agent: b\nDisallow: /x\n");
    assert.deepEqual(r.groups.map((g) => g.agents), [["a"], ["b"]]);
  });

  test("rules may start with * (RFC 9309 s5.1 uses *.gif$)", () => {
    clean("User-agent: *\nDisallow: *.gif$\n");
  });

  test("raw UTF-8 in paths and sitemap URLs is fine", () => {
    clean("User-agent: *\nDisallow: /foo/bar/\u30C4\nSitemap: https://ja.example.org/\u30C6\u30B9\u30C8.xml\n");
  });
});

describe("file rules", () => {
  test("file-html: an HTML page stops linting", () => {
    const f = only("\n<!DOCTYPE html>\n<html><body>Not found</body></html>\n", "file-html");
    assert.equal(f.severity, "error");
    assert.equal(f.line, 2);
    assert.deepEqual(lintRobotsTxt("<html>").groups, []);
    clean("User-agent: *\nDisallow: /<html>\n");
  });

  test("file-too-large: past 500 KiB, on the line where Google stops reading", () => {
    const line = "Disallow: /some/long/path/that/fills/the/file\n";
    const lines = Math.ceil((500 * 1024) / line.length) + 5;
    const r = lintRobotsTxt(`User-agent: *\n${line.repeat(lines)}`);
    const f = r.findings.find((x) => x.rule === "file-too-large");
    assert.ok(f);
    assert.equal(f.severity, "error");
    assert.equal(f.line, Math.floor((500 * 1024 - 14) / line.length) + 2);
    assert.equal(lintRobotsTxt(`User-agent: *\n${line.repeat(10)}`).findings.length, 0);
  });

  test("file-too-large counts UTF-8 bytes, not characters", () => {
    const ok = "a".repeat(500 * 1024);
    assert.deepEqual(lintRobotsTxt(`#${ok.slice(1)}`).findings, []);
    // 200,000 three-byte characters are 600,000 bytes.
    assert.equal(lintRobotsTxt(`#${"\u30C4".repeat(200_000)}`).findings[0].rule, "file-too-large");
  });

  test("location-invalid: only /robots.txt at the root counts", () => {
    const at = (url: string) => lintRobotsTxt("", { url }).findings.map((f) => f.rule);
    assert.deepEqual(at("https://example.com/robots.txt"), []);
    assert.deepEqual(at("https://example.com/robots.txt?x=1"), []);
    assert.deepEqual(at("https://example.com/folder/robots.txt"), ["location-invalid"]);
    assert.deepEqual(at("https://example.com/Robots.txt"), ["location-invalid"]);
  });

  test("an invalid options.url throws a TypeError; bad text never throws", () => {
    assert.throws(() => lintRobotsTxt("", { url: "/robots.txt" }), TypeError);
    assert.throws(() => lintRobotsTxt(42 as unknown as string), TypeError);
  });
});

describe("line rules", () => {
  test("line-invalid: no colon and not a two-word field", () => {
    assert.equal(only("Block everything please\n", "line-invalid").severity, "error");
    only("User-agent: *\nDisallow\n", "line-invalid");
    only("User-agent: *\n: /a\n", "line-invalid");
    only("hello world\n", "line-invalid");
  });

  test("colon-missing: Google reads a two-word line without the colon", () => {
    const r = lintRobotsTxt("User-agent: *\nDisallow /private/\n");
    assert.deepEqual(rules(r), [["colon-missing", "warning", 2]]);
    assert.deepEqual(r.groups[0].rules, [{ type: "disallow", pattern: "/private/", line: 2 }]);
    assert.deepEqual(rules(lintRobotsTxt("User-agent *\nDisallow: /\n")).map((x) => x[0]), ["colon-missing", "disallow-all"]);
  });

  test("directive-misspelled: a warning for typos Google accepts, which still apply", () => {
    for (const key of ["Disalow", "Dissallow", "Dissalow", "Diasllow", "Disallaw", "Useragent", "Disallowed", "Sitemaps", "Site-map"]) {
      const value = key.toLowerCase().startsWith("s") ? "https://example.com/s.xml" : key.toLowerCase().startsWith("u") ? "*" : "/x";
      const r = lintRobotsTxt(`User-agent: a\n${key}: ${value}\n`);
      assert.deepEqual(rules(r), [["directive-misspelled", "warning", 2]], key);
    }
    const r = lintRobotsTxt("User agent: Googlebot\nDisalow: /x\n");
    assert.equal(r.findings.length, 2);
    assert.deepEqual(r.groups[0], { agents: ["Googlebot"], line: 1, rules: [{ type: "disallow", pattern: "/x", line: 2 }] });
  });

  test("directive-misspelled: an error for near misses no parser accepts, which are dropped", () => {
    for (const key of ["Dsallow", "Alow", "Allw", "User-agnet", "User_agent", "Sitemp", "Disallo"]) {
      const r = lintRobotsTxt(`User-agent: a\n${key}: /x\n`);
      assert.deepEqual(rules(r), [["directive-misspelled", "error", 2]], key);
      assert.equal(r.groups[0].rules.length, 0);
    }
  });

  test("directive-unsupported: fields Google ignores, in groups Google reads", () => {
    assert.match(only("User-agent: *\nCrawl-delay: 10\n", "directive-unsupported").message, /Bing honours it/);
    assert.match(only("User-agent: *\nNoindex: /drafts/\n", "directive-unsupported").message, /1 September 2019/);
    assert.match(only("Host: example.com\n", "directive-unsupported").message, /not part of RFC 9309/);
    only("User-agent: Googlebot\nNofollow: /x\n", "directive-unsupported");
    only("User-agent: Storebot-Google\nCrawl-delay: 1\n", "directive-unsupported");
  });

  test("directive-unsupported: not reported in a group only other crawlers read", () => {
    clean("User-agent: Bingbot\nCrawl-delay: 5\nDisallow: /x\nClean-param: ref /x\n");
  });

  test("rule-outside-group: an Allow or Disallow before any user-agent line is ignored", () => {
    const r = lintRobotsTxt("Disallow: /tmp/\nAllow: /a\nUser-agent: *\nDisallow: /b\n");
    assert.deepEqual(rules(r), [
      ["rule-outside-group", "error", 1],
      ["rule-outside-group", "error", 2],
    ]);
    assert.deepEqual(r.groups[0].rules.map((x) => x.pattern), ["/b"]);
    clean("Sitemap: https://example.com/s.xml\nUser-agent: *\nDisallow: /b\n");
  });

  test("user-agent-invalid: an error when no crawler can match", () => {
    const empty = lintRobotsTxt("User-agent:\nDisallow: /x\n");
    assert.deepEqual(rules(empty), [["user-agent-invalid", "error", 1]]);
    assert.deepEqual(empty.groups[0].agents, []);
    const wildcard = lintRobotsTxt("User-agent: *bot\nDisallow: /x\n");
    assert.deepEqual(rules(wildcard), [["user-agent-invalid", "error", 1]]);
    assert.deepEqual(wildcard.groups[0].agents, ["*bot"]);
  });

  test("user-agent-invalid: a warning for a version or a trailing wildcard, which Google reads as the token", () => {
    const r = lintRobotsTxt("User-agent: Googlebot/2.1\nUser-agent: Bingbot*\nUser-agent: * extra\nDisallow: /x\n");
    assert.deepEqual(rules(r), [
      ["user-agent-invalid", "warning", 1],
      ["user-agent-invalid", "warning", 2],
      ["user-agent-invalid", "warning", 3],
    ]);
    assert.match(r.findings[0].message, /Write "User-agent: Googlebot"/);
    assert.match(r.findings[1].message, /Wildcards don't work/);
    assert.deepEqual(r.groups[0].agents, ["Googlebot/2.1", "Bingbot*", "* extra"]);
  });

  test("user-agent-invalid: names outside the token grammar that may match their own crawler are left alone", () => {
    clean("User-agent: Googlebot-Image\nUser-agent: Some_Bot\nUser-agent: MJ12bot\nUser-agent: archive.org_bot\nUser-agent: 360Spider\nUser-agent: Offline Explorer\nDisallow: /x\n");
  });

  test("path-invalid: a pattern that can't match a path", () => {
    assert.match(only("User-agent: *\nDisallow: private/\n", "path-invalid").message, /Write "Disallow: \/private\/"/);
    assert.match(only("User-agent: *\nAllow: https://example.com/a?b=1\n", "path-invalid").message, /full URL.*Write "Allow: \/a\?b=1"/);
  });

  test("sitemap-invalid: only absolute http and https URLs", () => {
    for (const value of ["", "/sitemap.xml", "sitemap.xml", "ftp://example.com/s.xml", "https://"]) {
      const r = lintRobotsTxt(`Sitemap: ${value}\n`);
      assert.deepEqual(rules(r), [["sitemap-invalid", "error", 1]], value);
      assert.deepEqual(r.sitemaps, []);
    }
    assert.deepEqual(clean("Sitemap: http://example.com/a.xml\nsitemap: https://cdn.example.org/b.xml\n").sitemaps.length, 2);
  });
});

describe("group rules", () => {
  test("group-duplicate: a second group for the same agent, case-insensitive", () => {
    const r = lintRobotsTxt("User-agent: ExampleBot\nDisallow: /foo\n\nUser-agent: examplebot\nDisallow: /baz\n");
    assert.deepEqual(rules(r), [["group-duplicate", "warning", 4]]);
    assert.match(r.findings[0].message, /already has a group on line 1/);
    clean("User-agent: a\nUser-agent: a\nDisallow: /x\n");
    // A version or trailing * doesn't make it a different agent.
    assert.deepEqual(rules(lintRobotsTxt("User-agent: Googlebot\nDisallow: /a\n\nUser-agent: googlebot/2.1\nDisallow: /b\n")), [
      ["user-agent-invalid", "warning", 4],
      ["group-duplicate", "warning", 4],
    ]);
  });

  test("group-duplicate: names that share only Google's product token are different agents", () => {
    // Google's parser reads both as "Ai", but they are two crawlers (seen on amazon.com).
    clean("User-agent: AI2Bot\nDisallow: /\n\nUser-agent: Ai2Bot-Dolma\nDisallow: /\n");
    clean("User-agent: Panscient\nDisallow: /\n\nUser-agent: panscient.com\nDisallow: /\n");
  });

  test("rule-conflict: allow and disallow for the same normalised path in one group", () => {
    assert.deepEqual(rules(lintRobotsTxt("User-agent: *\nAllow: /folder\nDisallow: /folder\n")), [["rule-conflict", "warning", 3]]);
    assert.deepEqual(rules(lintRobotsTxt("User-agent: *\nDisallow: /%7Efoo\nAllow: /~foo\n")), [["rule-conflict", "warning", 3]]);
    clean("User-agent: *\nAllow: /folder/\nDisallow: /folder\n");
    clean("User-agent: a\nAllow: /x\nUser-agent: b\nDisallow: /x\n");
    clean("User-agent: *\nDisallow: /x\nDisallow: /x\n");
  });

  test("disallow-all: the * group blocking every path", () => {
    for (const pattern of ["/", "/*", "*"]) {
      assert.equal(only(`User-agent: *\nDisallow: ${pattern}\n`, "disallow-all").line, 2);
    }
    clean("User-agent: GPTBot\nDisallow: /\n");
    clean("User-agent: *\nDisallow: /$\n");
    assert.match(only("User-agent: *\nDisallow: /\n", "disallow-all").message, /blocks the whole site .* can't crawl any page\.$/);
  });

  test("disallow-all: with an Allow rule in the * group, doesn't claim the whole site is blocked", () => {
    const message = only("User-agent: *\nDisallow: /\nAllow: /$\nAllow: /blog/\n", "disallow-all").message;
    assert.match(message, /blocks every path that no Allow rule there opens,/);
    assert.doesNotMatch(message, /whole site|can't crawl any page/);
  });

  test("resources-blocked: CSS or JS blocked for Googlebot", () => {
    assert.equal(only("User-agent: *\nDisallow: /*.js$\n", "resources-blocked").line, 2);
    only("User-agent: Googlebot\nDisallow: /assets/*.css\n", "resources-blocked");
    only("User-agent: *\nDisallow: *.css?\n", "resources-blocked");
  });

  test("resources-blocked: not when an Allow wins, Googlebot has its own group, or the file isn't CSS or JS", () => {
    clean("User-agent: *\nDisallow: /assets/*.js\nAllow: /assets/*.js$\n");
    clean("User-agent: *\nDisallow: /*.css\n\nUser-agent: Googlebot\nAllow: /\n");
    clean("User-agent: *\nDisallow: /*.json\nDisallow: /*.jsp\n");
  });
});

describe("robustness", () => {
  test("the problems example reports every rule it was written for", () => {
    const r = lintRobotsTxt(example("robots-with-problems.txt"));
    assert.deepEqual(rules(r), [
      ["rule-outside-group", "error", 1],
      ["directive-misspelled", "warning", 4],
      ["colon-missing", "warning", 5],
      ["path-invalid", "error", 6],
      ["rule-conflict", "warning", 8],
      ["directive-unsupported", "warning", 9],
      ["directive-unsupported", "warning", 10],
      ["directive-misspelled", "error", 11],
      ["user-agent-invalid", "warning", 13],
      ["path-invalid", "error", 14],
      ["resources-blocked", "warning", 15],
      ["line-invalid", "error", 16],
      ["group-duplicate", "warning", 18],
      ["disallow-all", "warning", 19],
      ["sitemap-invalid", "error", 21],
    ]);
    assert.equal(r.valid, false);
    assert.equal(r.errorCount, 6);
    assert.equal(r.warningCount, 9);
  });

  test("runs in linear time on a large input", () => {
    const body = (n: number) => {
      const parts = ["User-agent: *"];
      for (let i = 0; i < n; i++) parts.push(`Disallow: /p${i}/*.css`, `Allow: /p${i}/*`, `User-agent: bot${String.fromCharCode(97 + (i % 26))}`, `Crawl-delay: ${i}`);
      return parts.join("\n");
    };
    const time = (n: number) => {
      const text = body(n);
      const start = performance.now();
      lintRobotsTxt(text);
      return performance.now() - start;
    };
    time(2_000); // warm up
    const small = time(5_000);
    const large = time(20_000);
    // Four times the input; a quadratic pass would take sixteen times as long.
    assert.ok(large < small * 8 + 50, `5k: ${small.toFixed(0)} ms, 20k: ${large.toFixed(0)} ms`);
  });

  test("a long run of unknown lines after many user-agent lines stays linear", () => {
    // Each unknown line once rescanned every agent of its group: about a minute for this 450 KiB file.
    const text = "User-agent: a\n".repeat(20_000) + "Foo: bar\n".repeat(20_000);
    const start = performance.now();
    assert.equal(lintRobotsTxt(text).findings.length, 0);
    assert.ok(performance.now() - start < 2_000, `${(performance.now() - start).toFixed(0)} ms`);
  });

  test("CSS and JS probes over a large group stay fast", () => {
    const text = `User-agent: *\n${"Disallow: /a.js\n".repeat(100)}${"Disallow: /some/long/path/x\n".repeat(25_000)}`;
    const start = performance.now();
    lintRobotsTxt(text);
    assert.ok(performance.now() - start < 3_000, `${(performance.now() - start).toFixed(0)} ms`);
  });

  test("pathological lines stay fast", () => {
    const start = performance.now();
    lintRobotsTxt(`User-agent: *\nDisallow: /${"*a".repeat(50_000)}\n${" ".repeat(200_000)}x\n${"*".repeat(100_000)}\n${"a".repeat(200_000)}: b\n`);
    assert.ok(performance.now() - start < 2_000);
  });

  test("never throws on random input", () => {
    const alphabet = ["User-agent", "Disallow", "Allow", "Sitemap", ":", " ", "\t", "\n", "\r", "#", "*", "$", "/", "%", "%2", "%E3", "a", "<html>", "\uFEFF", "\uD800", "\u30C4", "https://", "Crawl-delay", "Disalow"];
    let seed = 42;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    for (let i = 0; i < 2_000; i++) {
      let text = "";
      const length = Math.floor(random() * 60);
      for (let j = 0; j < length; j++) text += alphabet[Math.floor(random() * alphabet.length)];
      const r = lintRobotsTxt(text);
      assert.equal(r.valid, r.errorCount === 0);
      assert.equal(r.findings.length, r.errorCount + r.warningCount);
    }
  });
});
