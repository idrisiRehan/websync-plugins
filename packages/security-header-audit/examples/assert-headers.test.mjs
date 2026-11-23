// Example: fail a test run when your app's security headers regress.
// Run against your own server: APP_URL=http://localhost:3000/ node --test examples/assert-headers.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeHeaders } from "security-header-audit";

const url = process.env.APP_URL;

test("security headers stay hardened", { skip: !url && "set APP_URL to run" }, async () => {
  const res = await fetch(url);
  await res.body?.cancel();
  const { score, rules } = analyzeHeaders(res.headers);
  const failed = rules.filter((r) => r.status === "failed").map((r) => `${r.name}: ${r.message}`);
  assert.deepEqual(failed, []);
  assert.ok(score >= 90, `score ${score} is below 90`);
});
