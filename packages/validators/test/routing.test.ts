import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readPrefix, routingCheckDigit, routingChecksum, validateRoutingNumber } from "../src/routing.ts";

// Routing numbers in assigned ranges that pass the checksum. Their check digits
// were worked by hand from the published 3-7-1 rule, independently of routingChecksum().
const PUBLISHED = ["011000015", "021001208"];

describe("routingChecksum", () => {
  for (const rtn of PUBLISHED) {
    test(`${rtn} sums to a multiple of 10`, () => {
      assert.equal((routingChecksum(rtn) as number) % 10, 0);
    });
  }

  test("catches every single-digit change", () => {
    const base = PUBLISHED[0];
    for (let i = 0; i < 9; i++) {
      for (let d = 0; d <= 9; d++) {
        if (String(d) === base[i]) continue;
        const changed = base.slice(0, i) + d + base.slice(i + 1);
        assert.notEqual((routingChecksum(changed) as number) % 10, 0, changed);
      }
    }
  });

  test("routingCheckDigit agrees with the published numbers", () => {
    for (const rtn of PUBLISHED) assert.equal(routingCheckDigit(rtn.slice(0, 8)), rtn[8]);
  });
});

describe("readPrefix", () => {
  test("maps ranges to districts", () => {
    assert.equal(readPrefix(1)?.district, "Boston");
    assert.equal(readPrefix(32)?.district, "San Francisco");
    assert.equal(readPrefix(61)?.district, "Boston");
    assert.equal(readPrefix(0)?.district, null);
    assert.equal(readPrefix(80)?.meaning, "Traveler's checks");
  });

  test("rejects unassigned ranges", () => {
    for (const p of [13, 20, 33, 60, 73, 79, 81, 99]) assert.equal(readPrefix(p), null, String(p));
  });
});

describe("validateRoutingNumber", () => {
  test("a published number passes all checks", () => {
    const r = validateRoutingNumber("0110-0001 5");
    assert.equal(r.valid, true);
    assert.equal(r.district, "Boston");
  });

  test("an unassigned prefix fails even with a good checksum", () => {
    const first8 = "99000001";
    const r = validateRoutingNumber(first8 + routingCheckDigit(first8));
    assert.equal(r.checks.find((c) => c.id === "checksum")?.status, "pass");
    assert.equal(r.valid, false);
  });

  test("short input skips the later checks", () => {
    const r = validateRoutingNumber("12345");
    assert.equal(r.valid, false);
    assert.equal(r.checks.filter((c) => c.status === "skipped").length, 2);
  });
});
