import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { convertGtin, gtinCheckDigit, isValidGtin, validateGtin } from "../src/gtin.ts";

// Published examples: 6291041500213 is the GTIN-13 GS1 uses to illustrate its check digit
// calculation; 4006381333931 is the EAN-13 in Wikipedia's "International Article Number"
// article; 036000291452 is the UPC-A in Wikipedia's "Universal Product Code" article.
const PUBLISHED = { gs1: "6291041500213", ean13: "4006381333931", upcA: "036000291452" };

describe("gtinCheckDigit", () => {
  test("matches the published examples", () => {
    assert.equal(gtinCheckDigit("629104150021"), "3");
    assert.equal(gtinCheckDigit("400638133393"), "1");
    assert.equal(gtinCheckDigit("03600029145"), "2");
  });

  test("leading zeros never change the check digit", () => {
    for (const code of Object.values(PUBLISHED)) {
      const payload = code.slice(0, -1);
      assert.equal(gtinCheckDigit(payload.padStart(13, "0")), gtinCheckDigit(payload));
    }
  });

  test("returns null for non-digit or empty input", () => {
    assert.equal(gtinCheckDigit("12a4"), null);
    assert.equal(gtinCheckDigit(""), null);
  });
});

describe("validateGtin", () => {
  test("accepts the published examples and detects their type", () => {
    assert.equal(validateGtin(PUBLISHED.gs1).type, "GTIN-13");
    assert.equal(validateGtin(PUBLISHED.ean13).valid, true);
    const upc = validateGtin(PUBLISHED.upcA);
    assert.equal(upc.valid, true);
    assert.equal(upc.type, "GTIN-12");
    assert.equal(upc.gtin14, "00036000291452");
  });

  test("accepts GTIN-8 and GTIN-14", () => {
    assert.equal(validateGtin("40170725").type, "GTIN-8");
    assert.equal(validateGtin("40170725").valid, true);
    assert.equal(validateGtin("14006381333938").valid, true);
  });

  test("ignores spaces and hyphens", () => {
    const r = validateGtin(" 4006 3813-3393 1 ");
    assert.equal(r.normalized, "4006381333931");
    assert.equal(r.valid, true);
  });

  test("rejects every single-digit change of a valid code", () => {
    const code = PUBLISHED.ean13;
    for (let i = 0; i < code.length; i++) {
      for (let d = 0; d <= 9; d++) {
        if (String(d) === code[i]) continue;
        const changed = code.slice(0, i) + d + code.slice(i + 1);
        assert.equal(isValidGtin(changed), false, changed);
      }
    }
  });

  test("a wrong check digit names the expected one", () => {
    const r = validateGtin("4006381333930");
    assert.equal(r.valid, false);
    assert.equal(r.type, "GTIN-13");
    assert.equal(r.gtin14, null);
    const checksum = r.checks.find((c) => c.id === "checksum");
    assert.equal(checksum?.status, "fail");
    assert.match(checksum?.detail ?? "", /check digit for the rest is 1/);
  });

  test("letters fail the format check and skip the rest", () => {
    const r = validateGtin("400638133393A");
    assert.deepEqual(r.checks.map((c) => c.status), ["fail", "skipped", "skipped"]);
    assert.equal(r.type, null);
  });

  test("an unsupported length fails the length check and skips the checksum", () => {
    const r = validateGtin("123456789");
    assert.deepEqual(r.checks.map((c) => c.status), ["pass", "fail", "skipped"]);
    assert.match(r.checks[1].detail, /9 digits/);
  });

  test("empty input fails cleanly", () => {
    const r = validateGtin("");
    assert.equal(r.valid, false);
    assert.equal(r.checks[0].detail, "Nothing to check.");
  });

  test("every check is reported, always in the same order", () => {
    for (const input of ["", "abc", "123", PUBLISHED.ean13, "4006381333930"]) {
      assert.deepEqual(validateGtin(input).checks.map((c) => c.id), ["format", "length", "checksum"]);
    }
  });
});

describe("convertGtin", () => {
  test("pads up without changing the check digit", () => {
    assert.deepEqual(convertGtin(PUBLISHED.upcA, "GTIN-13"), { ok: true, value: `0${PUBLISHED.upcA}` });
    assert.deepEqual(convertGtin("40170725", "GTIN-14"), { ok: true, value: "00000040170725" });
  });

  test("shortens when only zeros are removed", () => {
    assert.deepEqual(convertGtin("04006381333931", "GTIN-13"), { ok: true, value: PUBLISHED.ean13 });
    assert.deepEqual(convertGtin(`0${PUBLISHED.upcA}`, "GTIN-12"), { ok: true, value: PUBLISHED.upcA });
  });

  test("refuses to drop a significant digit", () => {
    const r = convertGtin(PUBLISHED.ean13, "GTIN-12");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /without losing significant digits/);
  });

  test("indicator digit 1-9 builds a new GTIN-14 with a recomputed check digit", () => {
    const r = convertGtin(PUBLISHED.ean13, "GTIN-14", 1);
    assert.deepEqual(r, { ok: true, value: "14006381333938" });
    if (r.ok) assert.equal(isValidGtin(r.value), true);
  });

  test("indicator 0 is the same as plain padding", () => {
    assert.deepEqual(convertGtin(PUBLISHED.ean13, "GTIN-14", 0), convertGtin(PUBLISHED.ean13, "GTIN-14"));
  });

  test("an indicator for a target other than GTIN-14 is ignored", () => {
    assert.deepEqual(convertGtin(PUBLISHED.ean13, "GTIN-13", 5), { ok: true, value: PUBLISHED.ean13 });
  });

  test("rejects out-of-range and fractional indicators", () => {
    assert.equal(convertGtin(PUBLISHED.ean13, "GTIN-14", 10).ok, false);
    assert.equal(convertGtin(PUBLISHED.ean13, "GTIN-14", 1.5).ok, false);
    assert.equal(convertGtin(PUBLISHED.ean13, "GTIN-14", -1).ok, false);
  });

  test("refuses invalid input with the failing check's reason", () => {
    const r = convertGtin("4006381333930", "GTIN-14");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /check digit for the rest is 1/);
  });
});
