import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { IBAN_COUNTRIES, analyzeIban, generateIban, formatIban, validateIban } from "../src/iban.ts";

// Published specimen IBANs (SWIFT IBAN Registry / ECBS examples), one per layout family.
const KNOWN_VALID = [
  "DE89370400440532013000",
  "GB29NWBK60161331926819",
  "GB82WEST12345698765432",
  "FR1420041010050500013M02606",
  "NL91ABNA0417164300",
  "BE68539007547034",
  "CH9300762011623852957",
  "AT611904300234573201",
  "NO9386011117947",
  "IT60X0542811101000000123456",
  "ES9121000418450200051332",
  "MT84MALT011000012345MTLCAST001S",
  "SA0380000000608010167519",
  "AE070331234567890123456",
  "TR330006100519786457841326",
  "PL61109010140000071219812874",
  "IE29AIBK93115212345678",
];

describe("validateIban - ISO 13616 / ISO 7064 MOD 97-10", () => {
  for (const iban of KNOWN_VALID) {
    test(`accepts published specimen ${iban}`, () => {
      const r = validateIban(iban);
      assert.equal(r.valid, true, r.reason);
      assert.equal(r.country?.code, iban.slice(0, 2));
    });
  }

  test("accepts the paper (grouped, lower-case) form", () => {
    assert.equal(validateIban("gb29 nwbk 6016 1331 9268 19").valid, true);
  });

  test("rejects a single-digit typo via the checksum", () => {
    const r = validateIban("DE89370400440532013001");
    assert.equal(r.valid, false);
    assert.match(r.reason!, /Checksum/);
    assert.equal(r.country?.code, "DE");
  });

  test("rejects transposed adjacent digits via the checksum", () => {
    assert.equal(validateIban("DE89370400440532010300").valid, false);
  });

  test("rejects wrong check digits", () => {
    assert.equal(validateIban("DE88370400440532013000").valid, false);
  });

  test("rejects the wrong length for the country, naming the expected length", () => {
    const r = validateIban("DE8937040044053201300");
    assert.equal(r.valid, false);
    assert.equal(r.reason, "Germany IBANs are 22 characters long (found 21).");
  });

  test("rejects an unrecognised country code", () => {
    const r = validateIban("XX89370400440532013000");
    assert.equal(r.valid, false);
    assert.match(r.reason!, /Unrecognized country code "XX"/);
  });

  test("rejects punctuation and too-short input", () => {
    assert.match(validateIban("DE89-3704").reason!, /letters and digits/);
    assert.match(validateIban("DE89").reason!, /too short/);
  });
});

describe("IBAN_COUNTRIES length table", () => {
  // Total IBAN lengths per the SWIFT IBAN Registry.
  const EXPECTED_LENGTH: Record<string, number> = {
    AD: 24, AE: 23, AT: 20, BA: 20, BE: 16, BG: 22, BH: 22, CH: 21, CY: 28, CZ: 24, DE: 22, DK: 18,
    EE: 20, ES: 24, FI: 18, FO: 18, FR: 27, GB: 22, GI: 23, GL: 18, GR: 27, HR: 21, HU: 28, IE: 22,
    IL: 23, IS: 26, IT: 27, KW: 30, LB: 28, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, ME: 22, MK: 19,
    MT: 31, NL: 18, NO: 15, PK: 24, PL: 28, PS: 29, PT: 25, QA: 29, RO: 24, RS: 22, SA: 24, SE: 24,
    SI: 19, SK: 24, SM: 27, TR: 26, VA: 22,
    AL: 28, AZ: 28, BI: 27, BR: 29, BY: 28, CR: 22, DJ: 27, DO: 28, EG: 29, FK: 18, GE: 22, GT: 28,
    HN: 28, IQ: 23, JO: 30, KZ: 20, LC: 32, LY: 25, MD: 24, MN: 20, MR: 27, MU: 30, NI: 28, OM: 23,
    RU: 33, SC: 31, SD: 18, SO: 23, ST: 25, SV: 28, TL: 23, TN: 24, UA: 29, VG: 24, XK: 20, YE: 30,
  };

  test("every country's BBAN format yields the registry IBAN length", () => {
    for (const c of IBAN_COUNTRIES) {
      const generated = generateIban(c.code);
      assert.equal(generated.length, EXPECTED_LENGTH[c.code], `${c.code} (${c.name})`);
    }
  });

  test("list is sorted by country name with unique codes", () => {
    const names = IBAN_COUNTRIES.map((c) => c.name);
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
    assert.equal(new Set(IBAN_COUNTRIES.map((c) => c.code)).size, IBAN_COUNTRIES.length);
  });
});

describe("generateIban", () => {
  test("every generated IBAN, for every country, passes validation (20 samples each)", () => {
    for (const c of IBAN_COUNTRIES) {
      for (let i = 0; i < 20; i++) {
        const iban = generateIban(c.code);
        assert.ok(iban.startsWith(c.code));
        const r = validateIban(iban);
        assert.equal(r.valid, true, `${iban}: ${r.reason}`);
      }
    }
  });

  test("check digits are always two digits in 02..98", () => {
    for (let i = 0; i < 200; i++) {
      const cd = Number(generateIban("NO").slice(2, 4));
      assert.ok(cd >= 2 && cd <= 98, String(cd));
    }
  });

  test("throws for an unknown country", () => {
    assert.throws(() => generateIban("ZZ"), /Unknown IBAN country code/);
  });
});

describe("formatIban", () => {
  test("groups into blocks of four", () => {
    assert.equal(formatIban("DE89370400440532013000"), "DE89 3704 0044 0532 0130 00");
  });

  test("re-groups an already-spaced value", () => {
    assert.equal(formatIban("GB29 NWBK60161331926819"), "GB29 NWBK 6016 1331 9268 19");
  });
});

describe("analyzeIban", () => {
  // Example IBANs from the SWIFT IBAN Registry's per-country "electronic format example".
  const REGISTRY_EXAMPLES = [
    "DE89370400440532013000",
    "GB29NWBK60161331926819",
    "NL91ABNA0417164300",
    "FR1420041010050500013M02606",
    "CH9300762011623852957",
  ];

  for (const iban of REGISTRY_EXAMPLES) {
    test(`passes every check on ${iban}`, () => {
      const r = analyzeIban(iban);
      assert.equal(r.valid, true, JSON.stringify(r.checks));
      assert.equal(r.checks.length, 5);
    });
  }

  test("accepts spaces, lower case and an IBAN prefix", () => {
    const r = analyzeIban("IBAN gb29 nwbk 6016 1331 9268 19");
    assert.equal(r.valid, true);
    assert.equal(r.formatted, "GB29 NWBK 6016 1331 9268 19");
  });

  test("names the expected check digits when they are wrong", () => {
    const r = analyzeIban("DE88370400440532013000");
    assert.equal(r.valid, false);
    assert.equal(r.expectedCheckDigits, "89");
    assert.equal(r.checks.find((c) => c.id === "checksum")?.status, "fail");
  });

  test("points at the character that breaks the country layout", () => {
    // GB layout is 4 letters, then 14 digits: put a letter in the digit part.
    const r = analyzeIban("GB29NWBK6016133192681A");
    const format = r.checks.find((c) => c.id === "format");
    assert.equal(format?.status, "fail");
    assert.match(format?.detail ?? "", /Character 22/);
  });

  test("a wrong length skips format and checksum", () => {
    const r = analyzeIban("DE8937040044053201300");
    assert.equal(r.checks.find((c) => c.id === "length")?.status, "fail");
    assert.equal(r.checks.filter((c) => c.status === "skipped").length, 2);
  });

  test("an unknown country skips the rest", () => {
    const r = analyzeIban("ZZ89370400440532013000");
    assert.equal(r.country, null);
    assert.equal(r.checks.filter((c) => c.status === "skipped").length, 3);
  });

  test("agrees with validateIban on generated IBANs", () => {
    for (const c of IBAN_COUNTRIES) {
      const iban = generateIban(c.code);
      assert.equal(analyzeIban(iban).valid, validateIban(iban).valid, iban);
    }
  });
});

describe("registry coverage (Nov 2026)", () => {
  test("covers all 89 registry countries", () => {
    assert.equal(IBAN_COUNTRIES.length, 89);
    assert.equal(new Set(IBAN_COUNTRIES.map((c) => c.code)).size, 89);
  });

  // Registry examples for the countries added in Nov 2026 (NI, RU and ST use corrected
  // examples: the ones printed in SWIFT's Release 96 file fail their own checksum).
  const NEW_EXAMPLES = [
    "AL47212110090000000235698741", "AZ21NABZ00000000137010001944", "BI4210000100010000332045181",
    "BR1800360305000010009795493C1", "BY13NBRB3600900000002Z00AB00", "CR05015202001026284066",
    "DJ2100010000000154000100186", "DO28BAGR00000001212453611324", "EG380019000500000000263180002",
    "FK88SC123456789012", "GE29NB0000000101904917", "GT82TRAJ01020000001210029690",
    "HN88CABF00000000000250005469", "IQ98NBIQ850123456789012", "JO94CBJO0010000000000131000302",
    "KZ86125KZT5004100100", "LC55HEMM000100010012001200023015", "LY83002048000020100120361",
    "MD24AG000225100013104168", "MN121234123456789123", "MR1300020001010000123456753",
    "MU17BOMM0101101030300200000MUR", "NI45BAPR00000013000003558124", "OM810180000001299123456",
    "RU0304452522540817810538091310419", "SC18SSCB11010000000000001497USD", "SD2129010501234001",
    "SO211000001001000100141", "ST68000100010051845310112", "SV62CENR00000000000000700025",
    "TL380080012345678910157", "TN5910006035183598478831", "UA213223130000026007233566001",
    "VG96VPVG0000012345678901", "XK051212012345678906", "YE15CBYE0001018861234567891234",
  ];
  for (const iban of NEW_EXAMPLES) {
    test(`validates ${iban.slice(0, 2)} example`, () => {
      const r = analyzeIban(iban);
      assert.equal(r.valid, true, JSON.stringify(r.checks.filter((c) => c.status !== "pass")));
    });
  }
});
