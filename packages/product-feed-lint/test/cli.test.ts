// End-to-end tests: run the real CLI as a child process against temp files and a local HTTP
// server, so no external network is involved.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import { gzipSync } from "node:zlib";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { GOOGLE_ITEM, OPENAI_ITEM, jsonl, rss, tsv } from "./helpers.ts";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const EXAMPLES = fileURLToPath(new URL("../examples/", import.meta.url));
const CAP = 100 * 1024 * 1024;
const GOOD = tsv([GOOGLE_ITEM]);
const WARNING = tsv([{ ...GOOGLE_ITEM, price: "12.00" }]);
const ERROR = tsv([{ ...GOOGLE_ITEM, price: "$12" }]);

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function run(args: string[], stdin: string | Buffer = ""): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--conditions=websync-source", CLI, ...args]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.on("error", () => {}); // EPIPE when the CLI stops reading early
    child.stdin.end(stdin);
  });
}

let dir = "";
let server: Server;
let base = "";
let lastAgent = "";
const file = (name: string) => join(dir, name);

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "product-feed-lint-"));
  writeFileSync(file("good.tsv"), GOOD);
  writeFileSync(file("warning.tsv"), WARNING);
  writeFileSync(file("error.tsv"), ERROR);
  writeFileSync(file("feed.xml"), rss([GOOGLE_ITEM]));
  writeFileSync(file("openai.jsonl"), jsonl([{ ...OPENAI_ITEM, target_countries: ["US"] }]));
  writeFileSync(file("latin1.tsv"), Buffer.from([0x69, 0x64, 0x0a, 0x43, 0x61, 0x66, 0xe9, 0x0a]));
  writeFileSync(file("utf16.tsv"), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(GOOD, "utf16le")]));
  writeFileSync(file("feed.tsv.gz"), gzipSync(GOOD));
  writeFileSync(file("huge.tsv"), Buffer.alloc(CAP + 1, 0x61));

  server = createServer((req, res) => {
    if (req.url === "/feed.xml") {
      res.writeHead(200, { "content-type": "application/xml" });
      res.end(rss([GOOGLE_ITEM]));
    } else if (req.url === "/moved") {
      res.writeHead(301, { location: "/feed.xml" });
      res.end();
    } else if (req.url === "/agent") {
      lastAgent = req.headers["user-agent"] ?? "";
      res.writeHead(200, { "content-type": "text/plain" });
      res.end(GOOD);
    } else if (req.url === "/huge.tsv") {
      res.writeHead(200, { "content-type": "text/plain" });
      const chunk = Buffer.alloc(1024 * 1024, 0x61);
      let sent = 0;
      const pump = () => {
        while (sent <= 100) {
          sent++;
          if (!res.write(chunk)) return void res.once("drain", pump);
        }
        res.end();
      };
      res.on("error", () => {});
      pump();
    } else if (req.url === "/slow.tsv") {
      res.writeHead(200, { "content-type": "text/plain" });
      res.write("id\n"); // never ends
    } else {
      res.writeHead(404, { "content-type": "text/html" });
      res.end("<h1>Not found</h1>");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.closeAllConnections();
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("files and stdin", () => {
  test("a clean feed exits 0 with a summary line", async () => {
    const r = await run([file("good.tsv")]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /good\.tsv: google, tsv, 1 item\n/);
    assert.match(r.stdout, /No problems found\.\n$/);
  });

  test("errors exit 1 and show rule, row, item and attribute", async () => {
    const r = await run([file("error.tsv")]);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /ERROR {2}price-invalid \(row 2, item MUG-1, price\)\n {7}price: "\$12" isn't a price/);
    assert.match(r.stdout, /1 error, 0 warnings\n$/);
  });

  test("XML findings show lines", async () => {
    writeFileSync(file("bad.xml"), rss([{ ...GOOGLE_ITEM, price: "$12" }]));
    const r = await run([file("bad.xml")]);
    assert.match(r.stdout, /ERROR {2}price-invalid \(line 12, item MUG-1, price\)/);
  });

  test("warnings alone exit 0, and --max-warnings turns them into exit 1", async () => {
    assert.equal((await run([file("warning.tsv")])).code, 0);
    assert.equal((await run([file("warning.tsv"), "--max-warnings", "0"])).code, 1);
    assert.equal((await run([file("warning.tsv"), "--max-warnings", "1"])).code, 0);
  });

  test("--json prints the result with its source", async () => {
    const r = await run([file("error.tsv"), "--json"]);
    assert.equal(r.code, 1);
    const json = JSON.parse(r.stdout);
    assert.deepEqual(Object.keys(json), ["source", "valid", "target", "format", "itemCount", "errorCount", "warningCount", "findings"]);
    assert.equal(json.source, file("error.tsv"));
    assert.deepEqual(json.findings[0], { rule: "price-invalid", severity: "error", message: json.findings[0].message, line: 2, itemId: "MUG-1", attribute: "price" });
  });

  test("reads stdin with -", async () => {
    const r = await run(["-", "--json"], rss([GOOGLE_ITEM]));
    assert.equal(r.code, 0, r.stderr);
    const json = JSON.parse(r.stdout);
    assert.equal(json.source, "stdin");
    assert.equal(json.format, "xml");
  });

  test("--target openai", async () => {
    const r = await run([file("openai.jsonl"), "--target", "openai"]);
    assert.equal(r.code, 0, r.stdout);
    assert.match(r.stdout, /openai, jsonl, 1 item/);
    const google = await run([file("openai.jsonl")]);
    assert.equal(google.code, 1);
    assert.match(google.stdout, /format-unsupported/);
  });

  test("--format overrides detection", async () => {
    const r = await run([file("feed.xml"), "--format", "tsv", "--json"]);
    assert.equal(JSON.parse(r.stdout).format, "tsv");
  });

  test("UTF-16 with a byte order mark is read", async () => {
    const r = await run([file("utf16.tsv")]);
    assert.equal(r.code, 0, r.stderr);
  });

  test("invalid UTF-8 exits 2", async () => {
    const r = await run([file("latin1.tsv")]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /^product-feed-lint: .*latin1\.tsv is not valid UTF-8\.\n$/);
  });

  test("a compressed file exits 2 with a hint", async () => {
    const r = await run([file("feed.tsv.gz")]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /compressed \(gzip or zip\)\. Decompress it first\./);
  });

  test("a missing file exits 2", async () => {
    const r = await run([file("nope.tsv")]);
    assert.equal(r.code, 2);
    assert.equal(r.stderr, "product-feed-lint: File not found.\n");
  });

  test("refuses a file past the size cap", async () => {
    const r = await run([file("huge.tsv")]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /larger than 100 MB/);
  });

  test("stops reading an endless stdin at the size cap", { timeout: 60_000 }, async () => {
    const child = spawn(process.execPath, ["--conditions=websync-source", CLI, "-"]);
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d));
    child.stdin.on("error", () => {});
    const chunk = Buffer.alloc(256 * 1024, 0x61);
    const feed = () => {
      while (!child.stdin.destroyed && child.stdin.write(chunk));
    };
    child.stdin.on("drain", feed);
    feed();
    const code = await new Promise((resolve) => child.on("close", resolve));
    assert.equal(code, 2);
    assert.match(stderr, /larger than 100 MB/);
  });
});

describe("URLs", () => {
  test("fetches a feed and follows redirects", async () => {
    const r = await run([`${base}/moved`, "--json"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).source, `${base}/feed.xml (HTTP 200)`);
  });

  test("sends a User-Agent naming the package and repository", async () => {
    const r = await run([`${base}/agent`]);
    assert.equal(r.code, 0, r.stderr);
    const { version } = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    assert.equal(lastAgent, `product-feed-lint/${version} (+https://github.com/idrisiRehan/websync-plugins)`);
  });

  test("an HTTP error status exits 2", async () => {
    const r = await run([`${base}/missing.tsv`]);
    assert.equal(r.code, 2);
    assert.equal(r.stderr, `product-feed-lint: ${base}/missing.tsv answered HTTP 404.\n`);
  });

  test("stops reading a response past the size cap", { timeout: 60_000 }, async () => {
    const r = await run([`${base}/huge.tsv`]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /larger than 100 MB/);
  });

  test("--timeout aborts a slow response", async () => {
    const r = await run([`${base}/slow.tsv`, "--timeout", "300"]);
    assert.equal(r.code, 2);
    assert.equal(r.stderr, "product-feed-lint: The request timed out.\n");
  });

  test("an unreachable host exits 2", async () => {
    const r = await run(["http://127.0.0.1:1/feed.xml"]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /^product-feed-lint: fetch failed/);
  });
});

describe("examples", () => {
  test("the clean examples pass with no warnings", async () => {
    for (const [name, target] of [["google-feed.tsv", "google"], ["google-feed.xml", "google"], ["openai-feed.jsonl", "openai"]]) {
      const r = await run([join(EXAMPLES, name), "--target", target, "--max-warnings", "0"]);
      assert.equal(r.code, 0, `${name}: ${r.stdout}`);
    }
  });

  test("the problem examples fail", async () => {
    const google = await run([join(EXAMPLES, "google-feed-with-problems.tsv")]);
    assert.equal(google.code, 1);
    assert.match(google.stdout, /6 errors, 5 warnings\n$/);
    const openai = await run([join(EXAMPLES, "openai-feed-with-problems.csv"), "--target", "openai"]);
    assert.equal(openai.code, 1);
    assert.match(openai.stdout, /5 errors, 3 warnings\n$/);
  });
});

describe("usage", () => {
  test("usage errors exit 2 with a one-line message", async () => {
    const cases = [[], ["a", "b"], ["x", "--nope"], ["x", "--max-warnings", "-1"], ["x", "--timeout", "0"], ["x", "--target", "bing"], ["x", "--format", "jsonl"], ["x", "--target", "openai", "--format", "xml"], ["x", "--target", "toString"], ["http://exa mple.com/feed.xml"]];
    for (const args of cases) {
      const r = await run(args);
      assert.equal(r.code, 2, args.join(" "));
      assert.match(r.stderr, /^product-feed-lint: [^\n]+ Run "product-feed-lint --help" for usage\.\n$/, args.join(" "));
    }
  });

  test("--version and --help", async () => {
    assert.match((await run(["--version"])).stdout.trim(), /^\d+\.\d+\.\d+$/);
    const help = await run(["-h"]);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /product-feed-lint <file \| url \| ->/);
    assert.match(help.stdout, /--target <name>/);
  });
});
