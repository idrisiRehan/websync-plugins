// End-to-end tests: run the real CLI as a child process against the local test server.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { startServer, type TestServer } from "./server.ts";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function run(args: string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

let server: TestServer;
let base = "";
let dir = "";

function writeMap(name: string, text: string): string {
  const file = join(dir, name);
  writeFileSync(file, text);
  return file;
}

before(async () => {
  server = await startServer();
  base = server.base;
  dir = mkdtempSync(join(tmpdir(), "redirect-inspector-"));
});

after(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("CLI", () => {
  test("prints each hop with status, time and URL, and exits 0 without errors", async () => {
    const r = await run([`${base}/301`]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`^ {2}301 +\\d+ ms {2}${base}/301$`, "m"));
    assert.match(r.stdout, new RegExp(`^ {2}200 +\\d+ ms {2}${base}/ok$`, "m"));
    assert.match(r.stdout, new RegExp(`^Final: 200 ${base}/ok after 1 redirect$`, "m"));
    assert.match(r.stdout, /WARN {3}https-missing/);
  });

  test("errors exit 1 and show the rule and hop", async () => {
    const r = await run([`${base}/loop-a`]);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /ERROR {2}redirect-loop \(hop 2\)/);
    assert.match(r.stdout, /1 error, 0 warnings/);
  });

  test("checks several URLs and summarises", async () => {
    const r = await run([`${base}/301`, `${base}/to-missing`]);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /ERROR {2}final-status \(hop 2\)/);
    assert.match(r.stdout, /2 URLs checked: 1 with errors\./);
  });

  test("--json prints an array of results", async () => {
    const r = await run([`${base}/chain`, "--json"]);
    assert.equal(r.code, 0, r.stderr);
    const [result] = JSON.parse(r.stdout);
    assert.equal(result.url, `${base}/chain`);
    assert.equal(result.finalUrl, `${base}/ok`);
    assert.equal(result.finalStatus, 200);
    assert.equal(result.hops.length, 3);
    assert.ok(result.findings.some((f: { rule: string }) => f.rule === "redirect-chain"));
    assert.equal("expected" in result, false);
  });

  test("--expect exits 0 when the chain ends at the expected URL", async () => {
    const r = await run([`${base}/chain`, "--expect", `${base}/ok`]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`OK {2}ends at the expected ${base}/ok`));
  });

  test("--expect exits 1 on a different final URL", async () => {
    const r = await run([`${base}/301`, "--expect", `${base}/elsewhere`, "--json"]);
    assert.equal(r.code, 1);
    const [result] = JSON.parse(r.stdout);
    assert.equal(result.expected, `${base}/elsewhere`);
    assert.equal(result.matches, false);
    assert.equal(result.valid, true);
  });

  test("--map reports each mismatch and resolves target paths", async () => {
    const file = writeMap(
      "map.txt",
      [
        "# old URL            new URL",
        `${base}/301          ${base}/ok`,
        "",
        `${base}/relative     /ok?from=relative`,
        `${base}/302          ${base}/wrong`,
        `  ${base}/to-missing   ${base}/missing  `,
      ].join("\n"),
    );
    const r = await run(["--map", file]);
    assert.equal(r.code, 1);
    assert.match(r.stdout, new RegExp(`MISMATCH {2}expected ${base}/wrong, ended at ${base}/ok`));
    assert.equal((r.stdout.match(/^OK {2}/gm) ?? []).length, 3);
    assert.match(r.stdout, /4 URLs checked: 1 with errors, 1 not at the expected URL\./);

    const json = JSON.parse((await run(["--map", file, "--json"])).stdout);
    assert.deepEqual(json.map((x: { matches: boolean }) => x.matches), [true, true, false, true]);
    assert.equal(json[1].expected, `${base}/ok?from=relative`);
  });

  test("--map doesn't match a chain that never reached a final response", async () => {
    // The classic migration loop: the new URL redirects back to the old one, so the chain stops
    // at the expected URL without ending there.
    const file = writeMap("broken.txt", `${base}/loop-a ${base}/loop-b\n${base}/to-never /never\n`);
    const r = await run(["--map", file, "--timeout", "200"]);
    assert.equal(r.code, 2);
    assert.equal((r.stdout.match(/^MISMATCH {2}expected .*, but the chain never reached a final response$/gm) ?? []).length, 2);
    assert.match(r.stdout, /2 URLs checked: 2 with errors, 2 not at the expected URL\./);
    const json = JSON.parse((await run(["--map", file, "--timeout", "200", "--json"])).stdout);
    assert.deepEqual(json.map((x: { matches: boolean }) => x.matches), [false, false]);
  });

  test("--map exits 0 when every redirect matches", async () => {
    const file = writeMap("good.txt", `${base}/301 ${base}/ok\r\n${base}/308 ${base}/ok\r\n`);
    const r = await run(["--map", file]);
    assert.equal(r.code, 0, r.stderr);
  });

  test("a malformed map line exits 2 with its line number", async () => {
    const file = writeMap("bad.txt", `${base}/308 ${base}/ok\n# comment\n${base}/301 ${base}/ok extra\n`);
    const before = server.requests.length;
    const r = await run(["--map", file]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /bad\.txt line 3: expected "from-url target-url", found 3 fields\./);
    assert.equal(server.requests.length, before, "nothing is fetched when the map is invalid");
  });

  test("an empty or missing map exits 2", async () => {
    assert.match((await run(["--map", writeMap("empty.txt", "# nothing\n\n")])).stderr, /has no redirects to check/);
    const missing = await run(["--map", join(dir, "nope.txt")]);
    assert.equal(missing.code, 2);
    assert.match(missing.stderr, /^redirect-inspector: File not found\.$/m);
  });

  test("a failed request exits 2", async () => {
    const r = await run([`${base}/never`, "--timeout", "200"]);
    assert.equal(r.code, 2);
    assert.match(r.stdout, /ERROR {2}request-failed/);
    assert.match(r.stdout, /timed out after 200 ms/);
    assert.match(r.stderr, /^redirect-inspector: 1 request failed\.$/m);
  });

  test("--method HEAD sends HEAD", async () => {
    const r = await run([`${base}/get-only`, "--method", "head"]);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /Final: 405/);
    assert.equal(server.requests.at(-1)?.method, "HEAD");
  });

  test("--max-hops limits the redirects followed", async () => {
    const r = await run([`${base}/n/2`, "--max-hops", "1"]);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /ERROR {2}too-many-hops \(hop 2\)/);
    assert.equal((await run([`${base}/n/2`, "--max-hops", "2"])).code, 0);
  });

  test("usage errors exit 2 with usage", async () => {
    const cases: [string[], RegExp][] = [
      [[], /Give at least one URL/],
      [["example.com"], /Not a valid URL: example\.com/],
      [["ftp://example.com/"], /Only http and https/],
      [[`${base}/ok`, `${base}/301`, "--expect", `${base}/ok`], /--expect works with exactly one URL/],
      [["--map", "x.txt", `${base}/ok`], /--map can't be combined/],
      [[`${base}/ok`, "--method", "POST"], /--method must be GET or HEAD/],
      [[`${base}/ok`, "--max-hops=-1"], /--max-hops must be a whole number from 0 to 50/],
      [[`${base}/ok`, "--max-hops", "51"], /--max-hops must be a whole number from 0 to 50/],
      [[`${base}/ok`, "--timeout", "0"], /--timeout must be a whole number/],
      [["--nope"], /Unknown option/],
    ];
    for (const [args, message] of cases) {
      const r = await run(args);
      assert.equal(r.code, 2, args.join(" "));
      assert.match(r.stderr, message);
      assert.match(r.stderr, /Usage:/);
    }
  });

  test("--version and --help", async () => {
    assert.match((await run(["--version"])).stdout.trim(), /^\d+\.\d+\.\d+$/);
    assert.match((await run(["--help"])).stdout, /--map <file>/);
  });
});
