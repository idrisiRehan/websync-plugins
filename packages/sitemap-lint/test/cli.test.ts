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
import { gzipSync } from "node:zlib";
import type { AddressInfo } from "node:net";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const NS = "http://www.sitemaps.org/schemas/sitemap/0.9";
const GOOD = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="${NS}">\n<url><loc>https://example.com/</loc></url>\n</urlset>\n`;
const WARNING = GOOD.replace("</loc>", "</loc><priority>2</priority>");
const ERROR = GOOD.replace("https://example.com/", "/relative");

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

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "sitemap-lint-"));
  writeFileSync(join(dir, "good.xml"), GOOD);
  writeFileSync(join(dir, "error.xml"), ERROR);
  writeFileSync(join(dir, "warning.xml"), WARNING);
  writeFileSync(join(dir, "good.xml.gz"), gzipSync(GOOD));
  writeFileSync(join(dir, "bomb.xml.gz"), gzipSync(Buffer.alloc(51 * 1024 * 1024, 0x20)));

  server = createServer((req, res) => {
    if (req.url === "/sitemap.xml") {
      res.writeHead(200, { "content-type": "application/xml" });
      res.end(GOOD);
    } else if (req.url === "/old") {
      res.writeHead(301, { location: "/sitemap.xml" });
      res.end();
    } else if (req.url === "/sitemap.xml.gz") {
      res.writeHead(200, { "content-type": "application/gzip" });
      res.end(gzipSync(GOOD));
    } else if (req.url === "/huge.xml") {
      res.writeHead(200, { "content-type": "application/xml" });
      const chunk = Buffer.alloc(1024 * 1024, 0x20);
      for (let i = 0; i < 51; i++) res.write(chunk);
      res.end();
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
    const r = await run([join(dir, "good.xml")]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /urlset, 1 entry/);
    assert.match(r.stdout, /No problems found\./);
  });

  test("errors exit 1 and show rule, line and entry", async () => {
    const r = await run([join(dir, "error.xml")]);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /ERROR {2}loc-invalid \(line 3, entry 1\)/);
    assert.match(r.stdout, /1 error, 0 warnings/);
  });

  test("warnings alone exit 0", async () => {
    const r = await run([join(dir, "warning.xml")]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /WARN {3}priority-invalid/);
  });

  test("--max-warnings turns too many warnings into exit 1", async () => {
    assert.equal((await run([join(dir, "warning.xml"), "--max-warnings", "0"])).code, 1);
    assert.equal((await run([join(dir, "warning.xml"), "--max-warnings", "1"])).code, 0);
  });

  test("--json prints the full result", async () => {
    const r = await run([join(dir, "error.xml"), "--json"]);
    const json = JSON.parse(r.stdout);
    assert.equal(json.valid, false);
    assert.equal(json.findings[0].rule, "loc-invalid");
    assert.equal(json.findings[0].line, 3);
  });

  test("reads stdin with -", async () => {
    const r = await run(["-", "--json"], GOOD);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).source, "stdin");
  });

  test("decompresses .xml.gz files and gzipped stdin", async () => {
    assert.equal((await run([join(dir, "good.xml.gz")])).code, 0);
    assert.equal((await run(["-"], gzipSync(GOOD))).code, 0);
  });

  test("refuses a gzip that inflates past 50 MB", async () => {
    const r = await run([join(dir, "bomb.xml.gz")]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /50 MB limit/);
  });

  test("fetches a URL, following redirects", async () => {
    const r = await run([`${base}/old`, "--json"]);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).source, `${base}/sitemap.xml (HTTP 200)`);
  });

  test("fetches a gzipped sitemap URL", async () => {
    assert.equal((await run([`${base}/sitemap.xml.gz`])).code, 0);
  });

  test("stops reading a response past 50 MB", async () => {
    const r = await run([`${base}/huge.xml`]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /50 MB limit/);
  });

  test("an HTTP error status exits 2", async () => {
    const r = await run([`${base}/missing.xml`]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /HTTP 404/);
  });

  test("a missing file exits 2", async () => {
    const r = await run([join(dir, "nope.xml")]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /File not found/);
  });

  test("usage errors exit 2 with usage", async () => {
    for (const args of [[], ["a", "b"], ["--nope"], [join(dir, "good.xml"), "--max-warnings", "-1"]]) {
      const r = await run(args);
      assert.equal(r.code, 2, args.join(" "));
      assert.match(r.stderr, /Usage:|must be a whole number/);
    }
  });

  test("--version and --help", async () => {
    assert.match((await run(["--version"])).stdout.trim(), /^\d+\.\d+\.\d+$/);
    assert.match((await run(["--help"])).stdout, /--max-warnings/);
  });
});
