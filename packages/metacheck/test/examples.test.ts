// The examples are shown in the README, so their findings are pinned here.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lintMetadata } from "../src/lint.ts";

const example = (name: string) => readFileSync(new URL(`../examples/${name}`, import.meta.url), "utf8");

test("clean-page.html has no findings", () => {
  const r = lintMetadata(example("clean-page.html"), { url: "https://example.com/shoes/trail/" });
  assert.deepEqual(r.findings, []);
  assert.equal(r.metadata.title, "Trail Running Shoes for Wet Ground | Example Outdoor");
  assert.equal(r.metadata.hreflang.length, 3);
  assert.deepEqual(r.metadata.headings.map((h) => h.level), [1, 2, 3, 2]);
});

test("page-with-problems.html reports each planted problem", () => {
  const r = lintMetadata(example("page-with-problems.html"));
  assert.deepEqual(
    r.findings.map((f) => `${f.rule}:${f.line ?? "-"}`),
    [
      "doctype-missing:-",
      "charset-missing:-",
      "og-missing:-",
      "lang-missing:1",
      "title-too-short:3",
      "description-empty:4",
      "robots-directive-unknown:6",
      "robots-noindex:6",
      "robots-googlebot:7",
      "canonical-relative:8",
      "canonical-multiple:9",
      "hreflang-invalid:10",
      "hreflang-x-default-missing:10",
      "hreflang-href-invalid:11",
      "og-image-invalid:13",
      "twitter-card-invalid:14",
      "metadata-in-body:17",
      "meta-duplicate:17",
      "metadata-in-body:18",
      "heading-skipped:22",
      "h1-multiple:23",
    ],
  );
  assert.equal(r.errorCount, 7);
  assert.equal(r.warningCount, 14);
});
