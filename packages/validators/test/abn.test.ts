import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { abnChecksum, acnCheckDigit, isValidAbn, isValidAcn, validateAbnOrAcn } from "../src/abn.ts";

// 51 824 753 556 is the ABN the ATO itself uses in its published description of the check.
// 000 000 019 and 004 085 616 are ACNs whose check digits were worked by hand from ASIC's
// published 8-to-1 weighting, independently of acnCheckDigit().
const PUBLISHED_ABN = "51824753556";
const PUBLISHED_ACNS = ["000000019", "004085616"];

describe("ABN checksum", () => {
  test("accepts the ATO's published example", () => {
    assert.equal(abnChecksum(PUBLISHED_ABN), 534);
    assert.equal(isValidAbn(PUBLISHED_ABN), true);
  });

  test("rejects every single-digit change of the published example", () => {
    for (let i = 0; i < 11; i++) {
      for (let d = 0; d <= 9; d++) {
        if (String(d) === PUBLISHED_ABN[i]) continue;
        const changed = PUBLISHED_ABN.slice(0, i) + d + PUBLISHED_ABN.slice(i + 1);
        assert.equal(isValidAbn(changed), false, changed);
      }
    }
  });

  test("rejects a leading zero and wrong lengths", () => {
    assert.equal(isValidAbn("0" + PUBLISHED_ABN.slice(1)), false);
    assert.equal(isValidAbn(PUBLISHED_ABN.slice(1)), false);
  });
});

describe("ACN check digit", () => {
  for (const acn of PUBLISHED_ACNS) {
    test(`reproduces the check digit of ${acn}`, () => {
      assert.equal(acnCheckDigit(acn.slice(0, 8)), acn[8]);
      assert.equal(isValidAcn(acn), true);
    });
  }

  test("remainder 0 gives check digit 0", () => {
    // 5 at weight 2 gives a weighted sum of 10, remainder 0.
    assert.equal(acnCheckDigit("00000050"), "0");
  });
});

describe("validateAbnOrAcn", () => {
  test("strips spaces and hyphens and detects an ABN", () => {
    const r = validateAbnOrAcn(" 51 824-753 556 ");
    assert.equal(r.kind, "abn");
    assert.equal(r.valid, true);
    assert.equal(r.formatted, "51 824 753 556");
  });

  test("detects an ACN", () => {
    const r = validateAbnOrAcn("004 085 616");
    assert.equal(r.kind, "acn");
    assert.equal(r.valid, true);
    assert.equal(r.formatted, "004 085 616");
  });

  test("reports the embedded ACN of a company-style ABN", () => {
    // Find the two-digit prefix that makes 004085616 a valid ABN.
    const prefix = Array.from({ length: 90 }, (_, i) => String(i + 10)).find((p) => isValidAbn(p + "004085616"));
    assert.ok(prefix);
    const r = validateAbnOrAcn(prefix + "004085616");
    assert.equal(r.valid, true);
    assert.equal(r.embeddedAcn, "004085616");
  });

  test("letters fail and skip the checksum", () => {
    const r = validateAbnOrAcn("51824753A56");
    assert.equal(r.valid, false);
    assert.equal(r.checks.find((c) => c.id === "checksum")?.status, "skipped");
  });

  test("a wrong length fails", () => {
    const r = validateAbnOrAcn("1234567890");
    assert.equal(r.kind, "unknown");
    assert.equal(r.valid, false);
  });
});
