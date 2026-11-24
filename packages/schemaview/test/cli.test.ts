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
const GOOD = JSON.stringify({ "@context": "https://schema.org", "@type": "Thing", name: "x" });
const WARNING = JSON.stringify({ "@context": "https://schema.org", "@type": "Thing", url: "/relative" });
const PAGE = `<!doctype html>\n<html><head>\n<script type="application/ld+json">${GOOD}</script>\n</head></html>`;
const RELATIVE_IMAGE_PAGE = `<script type="application/ld+json">${JSON.stringify({ "@context": "https://schema.org", "@type": "Thing", image: "/a.png" })}</script>`;

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function run(args: string[], stdin?: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--conditions=websync-source", CLI, ...args]);
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
let userAgent = "";

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "schemaview-"));
  writeFileSync(join(dir, "good.jsonld"), GOOD);
  writeFileSync(join(dir, "warning.jsonld"), WARNING);
  writeFileSync(join(dir, "huge.html"), Buffer.alloc(10 * 1024 * 1024 + 1, 0x20));

  server = createServer((req, res) => {
    userAgent = req.headers["user-agent"] ?? "";
    if (req.url === "/page") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(PAGE);
    } else if (req.url === "/old") {
      res.writeHead(301, { location: "/page" });
      res.end();
    } else if (req.url === "/shop/item") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(RELATIVE_IMAGE_PAGE);
    } else if (req.url === "/huge") {
      res.writeHead(200, { "content-type": "text/html" });
      const chunk = Buffer.alloc(1024 * 1024, 0x20);
      for (let i = 0; i < 11; i++) res.write(chunk);
      res.end();
    } else if (req.url === "/slow") {
      // Never answers, so the client's timeout fires.
    } else {
      res.writeHead(404);
      res.end("not found");
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

describe("CLI", () => {
  test("a clean file exits 0 with no problems", async () => {
    const r = await run([join(dir, "good.jsonld")]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /JSON-LD, 1 typed node/);
    assert.match(r.stdout, /No problems found\./);
  });

  test("the example page exits 1 and shows rule, line, path and the matched rich results", async () => {
    const r = await run([join(EXAMPLES, "product-with-problems.html")]);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /HTML, 2 JSON-LD blocks/);
    assert.match(r.stdout, / {2}Product \(line \d+\): Product snippet, Merchant listing/);
    assert.match(r.stdout, /ERROR {2}price-invalid \(line \d+, \$\.offers\.price\)/);
    assert.match(r.stdout, /\d+ errors, \d+ warnings/);
  });

  test("the valid example exits 0", async () => {
    const r = await run([join(EXAMPLES, "valid-article.jsonld")]);
    assert.equal(r.code, 0, r.stdout);
    assert.match(r.stdout, /NewsArticle \(line \d+\): Article/);
  });

  test("warnings alone exit 0", async () => {
    const r = await run([join(dir, "warning.jsonld")]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /WARN {3}url-relative/);
  });

  test("--max-warnings turns too many warnings into exit 1", async () => {
    assert.equal((await run([join(dir, "warning.jsonld"), "--max-warnings", "0"])).code, 1);
    assert.equal((await run([join(dir, "warning.jsonld"), "--max-warnings", "1"])).code, 0);
  });

  test("--json prints the full result", async () => {
    const r = await run([join(EXAMPLES, "product-with-problems.html"), "--json"]);
    const json = JSON.parse(r.stdout);
    assert.equal(json.valid, false);
    assert.equal(json.format, "html");
    assert.ok(json.entities.some((e: { types: string[] }) => e.types.includes("BreadcrumbList")));
    assert.ok(json.findings.every((f: { line: number; path: string }) => typeof f.line === "number" && f.path.startsWith("$")));
  });

  test("reads stdin with -", async () => {
    const r = await run(["-", "--json"], PAGE);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).source, "stdin");
  });

  test("empty input exits 2, so a failed fetch upstream can't pass", async () => {
    const r = await run(["-"], " \n");
    assert.equal(r.code, 2);
    assert.equal(r.stderr.trim(), "schemaview: The input is empty, so there was nothing to check.");
  });

  test("fetches a URL, following redirects, with its own user-agent", async () => {
    const r = await run([`${base}/old`, "--json"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).source, `${base}/page (HTTP 200)`);
    assert.match(userAgent, /^schemaview\/\d+\.\d+\.\d+ \(\+https:\/\//);
  });

  test("resolves relative URLs against the fetched page", async () => {
    const r = await run([`${base}/shop/item`]);
    assert.match(r.stdout, new RegExp(`resolves to ${base.replace(/\./g, "\\.")}/a\\.png`));
  });

  test("stops reading a response past the size cap", async () => {
    const r = await run([`${base}/huge`]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /^schemaview: The input is larger than 10 MB/);
  });

  test("refuses a file past the size cap", async () => {
    const r = await run([join(dir, "huge.html")]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /larger than 10 MB/);
  });

  test("times out with --timeout", async () => {
    const r = await run([`${base}/slow`, "--timeout", "200"]);
    assert.equal(r.code, 2);
    assert.equal(r.stderr.trim(), "schemaview: The request timed out.");
  });

  test("an HTTP error status exits 2", async () => {
    const r = await run([`${base}/missing`]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /HTTP 404/);
  });

  test("a network error exits 2 with one line", async () => {
    const r = await run(["http://127.0.0.1:1/"]);
    assert.equal(r.code, 2);
    assert.equal(r.stderr.trim().split("\n").length, 1);
  });

  test("a missing file exits 2", async () => {
    const r = await run([join(dir, "nope.html")]);
    assert.equal(r.code, 2);
    assert.equal(r.stderr.trim(), "schemaview: File not found.");
  });

  test("usage errors exit 2 with usage", async () => {
    for (const args of [[], ["a", "b"], ["--nope"], [join(dir, "good.jsonld"), "--max-warnings", "-1"], [join(dir, "good.jsonld"), "--timeout", "0"]]) {
      const r = await run(args);
      assert.equal(r.code, 2, args.join(" "));
      assert.match(r.stderr, /Usage:/);
    }
  });

  test("--version and --help", async () => {
    assert.match((await run(["--version"])).stdout.trim(), /^\d+\.\d+\.\d+$/);
    assert.match((await run(["-h"])).stdout, /--max-warnings/);
  });
});
