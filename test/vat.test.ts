import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { validateVatNumber, VAT_COUNTRIES } from "../src/vat.ts";

// Test numbers published in the python-stdnum test suite and docstrings (valid / invalid per
// stdnum). They exercise every branch: old/new formats, alternative check rules, edge cases.
const VALID: Record<string, string[]> = {
  AT: ["U13585627", "U15159209"],
  BE: ["0428759497", "428759497", "0697449992", "0202239951"],
  BG: ["175074752", "103873594", "131272009", "7501020018", "7111042925", "7153849522"],
  CY: ["10259033P", "10246672X"],
  CZ: ["25123891", "7103192745", "640903926", "6402294448", "991231123"],
  DE: ["136695976", "118619592"],
  DK: ["13585628", "10503280"],
  EE: ["100594102", "100931558"],
  EL: ["094259216", "039868210", "94051189"],
  ES: ["B64717838", "54362315K", "X5253868R", "M1234567L", "Q0818001J", "A11111119"],
  FI: ["20774740", "02459042"],
  FR: ["40303265045", "23334175221", "K7399859412", "4Z123456782", "23000047372"],
  HR: ["33392005961"],
  HU: ["12892312", "10672101"],
  IE: ["6433435F", "6433435OA", "8D79739I", "9Y71814N", "6433435IH"],
  IT: ["00743110157", "00118439991"],
  LT: ["119511515", "100001919017", "100004801610"],
  LU: ["15027442", "10059929"],
  LV: ["40003521600", "16117519997", "32867300679"],
  MT: ["11679112", "10396417"],
  NL: ["004495445B01", "4495445B01", "002455799B11", "001162938B28"],
  PL: ["8567346215", "5211355116"],
  PT: ["501964843", "500019720"],
  RO: ["18547290", "11358544", "573768", "1630615123457"],
  SE: ["123456789701", "556250398601"],
  SI: ["50223054", "26808498"],
  SK: ["2022749619", "1078449064"],
  GB: ["980780684", "100190874", "242338087388", "GD100", "HA501", "GD888810003", "HA888856782"],
  XI: ["432525179"],
};

const INVALID: Record<string, string[]> = {
  AT: ["U13585626"],
  BE: ["431150351", "2000021323", "0000000000"],
  BG: ["175074751"],
  CY: ["10259033Z", "12259033P"],
  CZ: ["25123890", "95123891"],
  DE: ["136695978", "011125440"],
  DK: ["13585627"],
  EE: ["100594103"],
  EL: ["123456781"],
  ES: ["B64717839", "O1234567L"],
  FI: ["20774741"],
  FR: ["84323140391", "IO334175221"],
  HR: ["33392005962"],
  HU: ["12892313"],
  IE: ["6433435E", "111222333", "1234567ABC"],
  IT: ["00743110158", "00687129980"],
  LT: ["100001919018", "100001354"],
  LU: ["15027443"],
  LV: ["40003521601", "16137519997"],
  MT: ["11679113"],
  NL: ["123456789B90", "009122746B00"],
  PL: ["8567346216"],
  PT: ["501964842"],
  RO: ["18547291", "1630615123458"],
  SE: ["123456789101"],
  SI: ["50223055"],
  SK: ["2022749618", "2010237945"],
  GB: ["802311781", "001234567", "GD600", "HA201", "HA888856700"],
};

describe("validateVatNumber - published valid numbers", () => {
  for (const [prefix, numbers] of Object.entries(VALID)) {
    for (const n of numbers) {
      test(`${prefix}${n}`, () => {
        const r = validateVatNumber(prefix + n);
        assert.equal(r.valid, true, JSON.stringify(r.checks));
      });
    }
  }
});

describe("validateVatNumber - published invalid numbers", () => {
  for (const [prefix, numbers] of Object.entries(INVALID)) {
    for (const n of numbers) {
      test(`${prefix}${n}`, () => {
        assert.equal(validateVatNumber(prefix + n).valid, false);
      });
    }
  }
});

describe("validateVatNumber - input handling", () => {
  test("every listed country has published valid numbers", () => {
    for (const c of VAT_COUNTRIES) assert.ok(VALID[c.prefix]?.length, c.prefix);
  });

  test("strips spaces, dots and hyphens and ignores case", () => {
    assert.equal(validateVatNumber("de 136.695-976").valid, true);
    assert.equal(validateVatNumber("gb 980 7806 84").valid, true);
  });

  test("accepts GR for Greece with a note", () => {
    const r = validateVatNumber("GR094259216");
    assert.equal(r.valid, true);
    assert.match(r.checks[0].detail, /EL/);
  });

  test("normalises old Belgian and Greek numbers", () => {
    assert.equal(validateVatNumber("BE428759497").number, "0428759497");
    assert.equal(validateVatNumber("EL94051189").number, "094051189");
  });

  test("GD/HA numbers pass with no check digit", () => {
    const r = validateVatNumber("GBGD100");
    assert.equal(r.valid, true);
    assert.equal(r.noCheckDigit, true);
  });

  test("a missing prefix fails and skips the rest", () => {
    const r = validateVatNumber("136695976");
    assert.equal(r.valid, false);
    assert.equal(r.checks.filter((c) => c.status === "skipped").length, 2);
  });

  test("an unknown prefix fails", () => {
    assert.equal(validateVatNumber("US123456789").valid, false);
  });

  test("a wrong format skips the check digits", () => {
    const r = validateVatNumber("DE12345");
    assert.equal(r.checks.find((c) => c.id === "format")?.status, "fail");
    assert.equal(r.checks.find((c) => c.id === "checksum")?.status, "skipped");
  });
});
