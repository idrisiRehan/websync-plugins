import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { computeCheckDigit, normalizeGstin, validateGstin, withCheckDigit, STATE_CODES } from "../src/gstin.ts";

// GSTINs that circulate widely as worked examples in GST documentation/tutorials. Each one's
// 15th character is a mod-36 check digit, so a random string matches by chance only 1 in 36.
const PUBLISHED_EXAMPLES = ["27AAPFU0939F1ZV", "29AAGCB7383J1Z4"];

// Independent re-implementation of the published GSTIN check-digit algorithm (Luhn mod-N, N=36),
// written from the spec rather than copied, so the test doesn't just restate the code.
function referenceCheckDigit(first14: string): string {
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let factor = 1;
  let sum = 0;
  for (const ch of first14) {
    const addend = factor * chars.indexOf(ch);
    sum += Math.floor(addend / 36) + (addend % 36);
    factor = factor === 1 ? 2 : 1;
  }
  return chars[(36 - (sum % 36)) % 36];
}

describe("computeCheckDigit", () => {
  for (const g of PUBLISHED_EXAMPLES) {
    test(`reproduces the check digit of published example ${g}`, () => {
      assert.equal(computeCheckDigit(g.slice(0, 14)), g[14]);
    });
  }

  test("agrees with an independent mod-36 implementation on many prefixes", () => {
    const pans = ["AAPFU0939F", "ABCDE1234F", "ZZZZZ9999Z", "AAACB0000A", "PQRST5678L"];
    for (const state of ["01", "07", "27", "29", "33", "36", "97", "99"]) {
      for (const pan of pans) {
        for (const entity of ["1", "2", "9", "A", "Z"]) {
          const prefix = `${state}${pan}${entity}Z`;
          assert.equal(computeCheckDigit(prefix), referenceCheckDigit(prefix), prefix);
        }
      }
    }
  });

  test("returns null for the wrong length or out-of-alphabet characters", () => {
    assert.equal(computeCheckDigit("27AAPFU0939F1"), null);
    assert.equal(computeCheckDigit("27AAPFU0939F1Z1"), null);
    assert.equal(computeCheckDigit("27aapfu0939F1Z"), null);
  });
});

describe("validateGstin", () => {
  for (const g of PUBLISHED_EXAMPLES) {
    test(`accepts ${g} with every check passing`, () => {
      const r = validateGstin(g);
      assert.equal(r.valid, true);
      assert.deepEqual(r.checks.map((c) => c.status), ["pass", "pass", "pass", "pass"]);
    });
  }

  test("decodes the positional parts", () => {
    const r = validateGstin("27AAPFU0939F1ZV");
    assert.equal(r.stateCode, "27");
    assert.equal(r.stateName, "Maharashtra");
    assert.equal(r.pan, "AAPFU0939F");
    assert.equal(r.panHolderType, "Firm or LLP");
    assert.equal(r.entityCode, "1");
    assert.equal(r.expectedCheckDigit, "V");
    assert.equal(r.providedCheckDigit, "V");
  });

  test("normalises spaces, hyphens and case before validating", () => {
    assert.equal(normalizeGstin(" 27aapfu-0939f 1zv "), "27AAPFU0939F1ZV");
    assert.equal(validateGstin("27 aapfu 0939f 1zv").valid, true);
  });

  test("a wrong check digit fails only the checkdigit check and names the expected digit", () => {
    const r = validateGstin("27AAPFU0939F1ZW");
    assert.equal(r.valid, false);
    const cd = r.checks.find((c) => c.id === "checkdigit")!;
    assert.equal(cd.status, "fail");
    assert.match(cd.detail, /gives V/);
    assert.equal(r.checks.filter((c) => c.status === "fail").length, 1);
  });

  test("a single-character typo in the PAN is caught by the check digit", () => {
    assert.equal(validateGstin("27AAPFU0938F1ZV").valid, false);
  });

  test("wrong length fails and skips the remaining checks", () => {
    const r = validateGstin("27AAPFU0939F1Z");
    assert.equal(r.valid, false);
    assert.deepEqual(r.checks.map((c) => [c.id, c.status]), [
      ["length", "fail"],
      ["pattern", "skipped"],
      ["state", "skipped"],
      ["checkdigit", "skipped"],
    ]);
    assert.match(r.checks[0].detail, /Got 14 characters/);
  });

  test("14th character must be Z", () => {
    const fixed = withCheckDigit("27AAPFU0939F1Y")!;
    const r = validateGstin(fixed);
    assert.equal(r.checks.find((c) => c.id === "pattern")!.status, "fail");
    assert.match(r.checks.find((c) => c.id === "pattern")!.detail, /character 14 must be the letter Z/);
  });

  test("an unlisted state code fails the state check even with a correct check digit", () => {
    const g = withCheckDigit("45AAPFU0939F1Z")!;
    const r = validateGstin(g);
    assert.equal(r.checks.find((c) => c.id === "checkdigit")!.status, "pass");
    assert.equal(r.checks.find((c) => c.id === "state")!.status, "fail");
    assert.equal(r.valid, false);
  });

  test("a malformed PAN segment fails the pattern check and leaves pan null", () => {
    const g = "2712345678901ZV";
    const r = validateGstin(g);
    assert.equal(r.checks.find((c) => c.id === "pattern")!.status, "fail");
    assert.equal(r.pan, null);
  });
});

describe("withCheckDigit", () => {
  test("appends the right digit, producing a GSTIN that validates", () => {
    assert.equal(withCheckDigit("27AAPFU0939F1Z"), "27AAPFU0939F1ZV");
    assert.equal(validateGstin(withCheckDigit("07ABCDE1234F2Z")!).valid, true);
  });

  test("returns null when the prefix isn't 14 valid characters", () => {
    assert.equal(withCheckDigit("27AAPFU"), null);
  });
});

describe("STATE_CODES", () => {
  test("covers the 38 numbered state/UT codes plus 97 and 99", () => {
    for (let n = 1; n <= 38; n++) {
      const code = String(n).padStart(2, "0");
      assert.ok(STATE_CODES[code], `missing ${code}`);
    }
    assert.ok(STATE_CODES["97"]);
    assert.ok(STATE_CODES["99"]);
  });
});
