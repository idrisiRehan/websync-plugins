// End-to-end tests: run the real CLI as a child process against temp files.

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
const SHOPIFY = "Title,URL handle,Price\nTee,tee,20\n";
const WOO = "Type,SKU,Name,Regular price\nsimple,A,Mug,5\n";

function run(args: string[], stdin = ""): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--conditions=websync-source", CLI, ...args]);
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin);
  });
}

let dir = "";
const file = (name: string) => join(dir, name);

before(() => {
  dir = mkdtempSync(join(tmpdir(), "product-csv-lint-"));
  writeFileSync(file("shopify.csv"), SHOPIFY);
  writeFileSync(file("woo.csv"), WOO);
  writeFileSync(file("error.csv"), "Title,URL handle,Price\nTee,tee,$20\n");
  writeFileSync(file("warning.csv"), "Title\nTee\n");
  writeFileSync(file("unknown.csv"), "name,email\na,b\n");
});

after(() => rmSync(dir, { recursive: true, force: true }));

describe("CLI", () => {
  test("detects Shopify and reports a clean file", async () => {
    const r = await run([file("shopify.csv")]);
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /shopify, 1 rows, 1 products, 1 variants/);
    assert.match(r.stdout, /No problems found\./);
  });

  test("detects WooCommerce", async () => {
    const r = await run([file("woo.csv"), "--json"]);
    assert.equal(JSON.parse(r.stdout).platform, "woocommerce");
  });

  test("errors exit 1 with rule, row and column", async () => {
    const r = await run([file("error.csv")]);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /ERROR {2}value-decimal \(row 2, Price\)/);
  });

  test("--max-warnings", async () => {
    assert.equal((await run([file("warning.csv"), "--platform", "shopify"])).code, 0);
    assert.equal((await run([file("warning.csv"), "--platform", "shopify", "--max-warnings", "0"])).code, 1);
  });

  test("--platform overrides detection", async () => {
    const r = await run([file("shopify.csv"), "--platform", "woocommerce", "--json"]);
    const json = JSON.parse(r.stdout);
    assert.equal(json.platform, "woocommerce");
    assert.equal(r.code, 1);
  });

  test("reads stdin", async () => {
    const r = await run(["-", "--json"], WOO);
    assert.equal(r.code, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).source, "stdin");
  });

  test("an undetectable file asks for --platform", async () => {
    const r = await run([file("unknown.csv")]);
    assert.equal(r.code, 2);
    assert.match(r.stderr, /Pass --platform/);
  });

  test("usage and input errors exit 2", async () => {
    for (const args of [[], [file("shopify.csv"), "--platform", "magento"], [file("nope.csv")], ["--nope"], [file("shopify.csv"), "--max-warnings", "x"]]) {
      const r = await run(args);
      assert.equal(r.code, 2, args.join(" "));
    }
  });

  test("--version and --help", async () => {
    assert.match((await run(["--version"])).stdout.trim(), /^\d+\.\d+\.\d+$/);
    assert.match((await run(["--help"])).stdout, /--platform/);
  });
});
