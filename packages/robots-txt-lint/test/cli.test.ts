// End-to-end tests: run the real CLI as a child process against temp files and a local HTTP
// server, so no external network is involved.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const EXAMPLES = fileURLToPath(new URL("../examples/", import.meta.url));
const GOOD = "User-agent: *\nDisallow: /private/\n\nUser-agent: GPTBot\nDisallow: /\n\nSitemap: https://example.com/sitemap.xml\n";
const WARNING = "User-agent: *\nCrawl-delay: 5\nDisallow: /tmp/\n";
const ERROR = "Disallow: /tmp/\n";

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function run(args: string[], stdin?: string | Buffer): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin ?? "");
  });
}

let dir = "";
let server: Server;
let base = "";
let lastUserAgent = "";

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "robots-txt-lint-"));
  writeFileSync(join(dir, "good.txt"), GOOD);
  writeFileSync(join(dir, "warning.txt"), WARNING);
  writeFileSync(join(dir, "error.txt"), ERROR);
  writeFileSync(join(dir, "latin1.txt"), Buffer.from([0x55, 0x73, 0x65, 0x72, 0x2d, 0x61, 0x67, 0x65, 0x6e, 0x74, 0x3a, 0x20, 0xe9, 0x0a]));
  // Over Google's 500 KiB but under the 1 MiB read cap: linted, with file-too-large.
  writeFileSync(join(dir, "large.txt"), `User-agent: *\n${"Disallow: /a-long-path-to-fill-the-file/\n".repeat(14_000)}`);
  writeFileSync(join(dir, "huge.txt"), Buffer.alloc(1024 * 1024 + 1, 0x61));

  server = createServer((req, res) => {
    const text = (status: number, body: string, type = "text/plain") => {
      res.writeHead(status, { "content-type": type });
      res.end(body);
    };
    lastUserAgent = req.headers["user-agent"] ?? "";
    if (req.url === "/robots.txt") text(200, GOOD);
    else if (req.url === "/robots.txt?empty") {
      res.writeHead(204);
      res.end();
    } else if (req.url === "/moved") {
      res.writeHead(301, { location: "/robots.txt" });
      res.end();
    } else if (req.url === "/spa/robots.txt") text(200, "<!doctype html>\n<html><body><div id=root></div></body></html>", "text/html");
    else if (req.url === "/blog/robots.txt") text(200, GOOD);
    else if (req.url === "/down/robots.txt") text(503, "Service unavailable");
    else if (req.url === "/busy/robots.txt") text(429, "Slow down");
    else if (req.url === "/huge.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      const chunk = Buffer.alloc(256 * 1024, 0x61);
      for (let i = 0; i < 6; i++) res.write(chunk);
      res.end();
    } else if (req.url === "/slow.txt") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.write("User-agent: *\n"); // never ends
    } else text(404, "<h1>Not found</h1>", "text/html");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("lint", () => {
  test("a clean file exits 0 with a summary line", async () => {
    const r = await run([join(dir, "good.txt")]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /good\.txt: 2 groups, 2 rules, 1 sitemap\n\nNo problems found\.\n$/);
  });

  test("errors exit 1 and show rule and line", async () => {
    const r = await run([join(dir, "error.txt")]);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /ERROR {2}rule-outside-group \(line 1\)\n {7}This Disallow line/);
    assert.match(r.stdout, /1 error, 0 warnings\n$/);
  });

  test("warnings alone exit 0; --max-warnings can fail them", async () => {
    assert.equal((await run([join(dir, "warning.txt")])).code, 0);
    assert.equal((await run([join(dir, "warning.txt"), "--max-warnings", "0"])).code, 1);
    assert.equal((await run([join(dir, "warning.txt"), "--max-warnings", "1"])).code, 0);
  });

  test("--json prints the full result", async () => {
    const r = await run([join(dir, "warning.txt"), "--json"]);
    const json = JSON.parse(r.stdout);
    assert.deepEqual(Object.keys(json), ["source", "valid", "errorCount", "warningCount", "findings", "groups", "sitemaps"]);
    assert.equal(json.valid, true);
    assert.deepEqual(json.findings[0], { rule: "directive-unsupported", severity: "warning", message: json.findings[0].message, line: 2 });
    assert.deepEqual(json.groups, [{ agents: ["*"], line: 1, rules: [{ type: "disallow", pattern: "/tmp/", line: 3 }] }]);
  });

  test("reads stdin with -", async () => {
    const r = await run(["-", "--json"], GOOD);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).source, "stdin");
  });

  test("the bundled examples", async () => {
    assert.equal((await run([join(EXAMPLES, "robots.txt"), "--max-warnings", "0"])).code, 0);
    const r = await run([join(EXAMPLES, "robots-with-problems.txt")]);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /6 errors, 9 warnings/);
  });

  test("a file over 500 KiB is linted and flagged", async () => {
    const r = await run([join(dir, "large.txt"), "--json"]);
    assert.equal(r.code, 1);
    assert.equal(JSON.parse(r.stdout).findings[0].rule, "file-too-large");
  });
});

describe("--test and --ai", () => {
  test("--test prints the verdict and the deciding rule", async () => {
    const r = await run([join(dir, "good.txt"), "--test", "/private/report.pdf"]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /\n\nTest: \/private\/report\.pdf as \*\nBLOCKED by line 2, "Disallow: \/private\/" \(the \* group, line 1\)\n$/);
  });

  test("--user-agent picks the group", async () => {
    const blocked = await run([join(dir, "good.txt"), "--test", "https://example.com/blog/", "--user-agent", "gptbot"]);
    assert.match(blocked.stdout, /BLOCKED by line 5, "Disallow: \/" \(the gptbot group, line 4\)/);
    const allowed = await run([join(dir, "good.txt"), "--test", "/blog/", "--user-agent", "Bingbot"]);
    assert.match(allowed.stdout, /ALLOWED because no rule matches \(the \* group, line 1\)/);
  });

  test("--test explains /robots.txt and a missing group", async () => {
    assert.match((await run([join(dir, "good.txt"), "--test", "/robots.txt"])).stdout, /ALLOWED because \/robots\.txt is always allowed/);
    const r = await run(["-", "--test", "/a", "--user-agent", "Googlebot"], "User-agent: Bingbot\nDisallow: /\n");
    assert.match(r.stdout, /ALLOWED because no group applies to Googlebot \(no group\)/);
  });

  test("--test with --json adds a test object", async () => {
    const r = await run([join(dir, "good.txt"), "--json", "--test", "/private/x", "--user-agent", "Googlebot"]);
    assert.deepEqual(JSON.parse(r.stdout).test, {
      userAgent: "Googlebot",
      url: "/private/x",
      allowed: false,
      rule: { type: "disallow", pattern: "/private/", line: 2 },
      group: "*",
      groupLines: [1],
      path: "/private/x",
    });
  });

  test("--ai prints the crawler table and the operators' notes", async () => {
    const r = await run([join(dir, "good.txt"), "--ai"]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /\nToken +Operator +Purpose +Access +Group\n/);
    assert.match(r.stdout, /\nGPTBot +OpenAI +training +blocked +own \(line 4\)\n/);
    assert.match(r.stdout, /\nCCBot +Common Crawl +dataset +partial +\* \(line 1\)\n/);
    assert.match(r.stdout, /Notes from the operators:\n {2}ChatGPT-User: /);
  });

  test("--ai with --json adds an ai array", async () => {
    const r = await run([join(dir, "good.txt"), "--ai", "--json"]);
    const gpt = JSON.parse(r.stdout).ai.find((c: { token: string }) => c.token === "GPTBot");
    assert.deepEqual([gpt.access, gpt.group, gpt.groupLines, gpt.purpose], ["blocked", "specific", [4], "training"]);
  });
});

describe("URLs", () => {
  test("a bare origin fetches /robots.txt, with the package's user agent", async () => {
    for (const target of [base, `${base}/`]) {
      const r = await run([target, "--json"]);
      assert.equal(r.code, 0, r.stderr);
      const json = JSON.parse(r.stdout);
      assert.equal(json.source, `${base}/robots.txt (HTTP 200)`);
      assert.equal(json.status, 200);
    }
    assert.match(lastUserAgent,/robots-txt-lint\/\d+\.\d+\.\d+ \(\+https:\/\/github\.com\/idrisiRehan\/websync-plugins\)/);
  });

  test("follows redirects and reports the final URL", async () => {
    const r = await run([`${base}/moved`, "--json"]);
    assert.equal(JSON.parse(r.stdout).source, `${base}/robots.txt (HTTP 200)`);
  });

  test("a robots.txt below the root is a location error", async () => {
    const r = await run([`${base}/blog/robots.txt`]);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /ERROR {2}location-invalid\n/);
  });

  test("an HTML page served as robots.txt is a lint error, not a crash", async () => {
    const r = await run([`${base}/spa/robots.txt`]);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /ERROR {2}file-html \(line 1\)/);
  });

  test("a 404 means no robots.txt: exit 0, and everything is allowed", async () => {
    // The query keeps the path at /robots.txt while the server answers 404.
    const r = await run([`${base}/robots.txt?missing`, "--test", "/anything"]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /^http:\/\/127\.0\.0\.1:\d+\/robots\.txt\?missing \(HTTP 404\): no robots\.txt\. Crawlers treat a 4xx as no file and may crawl everything \(RFC 9309 s2\.3\.1\.3\)\.\n/);
    assert.match(r.stdout, /ALLOWED because no group applies to \*/);
    const json = JSON.parse((await run([`${base}/robots.txt?missing`, "--json"])).stdout);
    assert.deepEqual([json.status, json.valid, json.findings, json.groups], [404, true, [], []]);
  });

  test("a 404 below the root is a location error, not a missing robots.txt", async () => {
    const r = await run([`${base}/missing/robots.txt`]);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /\(HTTP 404\): 0 groups, 0 rules, 0 sitemaps\nERROR {2}location-invalid\n/);
    assert.doesNotMatch(r.stdout, /may crawl everything/);
  });

  test("a 2xx without a body (204) is an empty file", async () => {
    const r = await run([`${base}/robots.txt?empty`]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /\(HTTP 204\): 0 groups, 0 rules, 0 sitemaps\n\nNo problems found\.\n$/);
  });

  test("a 5xx exits 2 and says crawlers assume a complete disallow", async () => {
    const r = await run([`${base}/down/robots.txt`]);
    assert.equal(r.code, 2);
    assert.equal(r.stderr, `robots-txt-lint: ${base}/down/robots.txt answered HTTP 503. RFC 9309 s2.3.1.4 tells crawlers to assume a complete disallow while the file is unreachable.\n`);
  });

  test("a 429 exits 2", async () => {
    const r = await run([`${base}/busy/robots.txt`]);
    assert.equal(r.code, 2);
    assert.equal(r.stderr, `robots-txt-lint: ${base}/busy/robots.txt answered HTTP 429.\n`);
  });

  test("stops reading a response past the size cap", async () => {
    const r = await run([`${base}/huge.txt`]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /larger than 1 MiB/);
  });

  test("--timeout aborts a slow response", async () => {
    const r = await run([`${base}/slow.txt`, "--timeout", "300"]);
    assert.equal(r.code, 2);
    assert.equal(r.stderr, "robots-txt-lint: The request timed out.\n");
  });

  test("an unreachable host exits 2", async () => {
    const r = await run(["http://127.0.0.1:1/robots.txt"]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /^robots-txt-lint: fetch failed/);
  });
});

describe("input errors", () => {
  test("refuses a local file past the size cap", async () => {
    const r = await run([join(dir, "huge.txt")]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /larger than 1 MiB, so it was not linted/);
  });

  test("stops reading an endless stdin at the size cap", { timeout: 20_000 }, async () => {
    const child = spawn(process.execPath, [CLI, "-"]);
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    child.stdin.on("error", () => {}); // EPIPE once the CLI gives up
    const chunk = Buffer.alloc(64 * 1024, 0x61);
    const feed = () => {
      while (!child.stdin.destroyed && child.stdin.write(chunk));
    };
    child.stdin.on("drain", feed);
    feed();
    const code = await new Promise((resolve) => child.on("close", resolve));
    assert.equal(code, 2);
    assert.match(stderr, /larger than 1 MiB/);
  });

  test("invalid UTF-8 exits 2", async () => {
    const r = await run([join(dir, "latin1.txt")]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /not valid UTF-8, which RFC 9309 s2\.3 requires/);
  });

  test("a missing file exits 2", async () => {
    const r = await run([join(dir, "nope.txt")]);
    assert.equal(r.code, 2);
    assert.equal(r.stderr, "robots-txt-lint: File not found.\n");
  });
});

describe("usage", () => {
  test("usage errors exit 2 with a one-line message", async () => {
    const cases = [
      [],
      ["a", "b"],
      ["x", "--nope"],
      ["x", "--max-warnings", "-1"],
      ["x", "--timeout", "0"],
      ["x", "--user-agent", "Googlebot"],
      ["x", "--test", "/a", "--user-agent", "Googlebot/2.1"],
      ["x", "--test", "relative"],
      ["http://exa mple.com"],
    ];
    for (const args of cases) {
      const r = await run(args);
      assert.equal(r.code, 2, args.join(" "));
      assert.match(r.stderr, /^robots-txt-lint: [^\n]+ Run "robots-txt-lint --help" for usage\.\n$/, args.join(" "));
    }
  });

  test("--version and --help", async () => {
    assert.match((await run(["--version"])).stdout.trim(), /^\d+\.\d+\.\d+$/);
    const help = await run(["-h"]);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /robots-txt-lint <file \| url \| -> \[options\]/);
  });
});
