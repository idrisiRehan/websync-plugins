import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { availabilityOfFeed, availabilityOfSchema, compareDecimal, parseDate, parseDecimal, parseEndDate, parseMoney } from "../src/values.ts";

describe("decimals", () => {
  test("canonical form: no leading zeros, no trailing fraction zeros", () => {
    const cases: [string, string][] = [["18", "18"], ["18.00", "18"], ["018.50", "18.5"], ["0.30", "0.3"], ["0", "0"], ["000", "0"], ["0.000", "0"], [" 7.10 ", "7.1"], ["12345678901234567890.10", "12345678901234567890.1"]];
    for (const [input, canonical] of cases) assert.equal(parseDecimal(input), canonical, input);
  });

  test("anything but a plain decimal is null", () => {
    for (const input of ["", "1,299.00", "18,00", "$18", "18 USD", "1e3", "-1", "+1", ".5", "5.", "1.2.3", "NaN", "Infinity", "0x10", String.fromCharCode(0xff11, 0xff18) /* fullwidth 18 */]) {
      assert.equal(parseDecimal(input), null, input);
    }
  });

  test("compareDecimal orders exactly, beyond double precision", () => {
    const sorted = ["0", "0.01", "0.1", "0.3", "1", "9.99", "10", "18", "18.000000000000000001", "100", "12345678901234567890", "12345678901234567890.1"];
    for (let i = 0; i < sorted.length; i++) {
      for (let j = 0; j < sorted.length; j++) {
        assert.equal(Math.sign(compareDecimal(sorted[i], sorted[j])), Math.sign(i - j), `${sorted[i]} vs ${sorted[j]}`);
      }
    }
  });
});

describe("feed prices", () => {
  test("amount and optional ISO 4217 code", () => {
    assert.deepEqual(parseMoney("18.00 USD"), { amount: "18", currency: "USD" });
    assert.deepEqual(parseMoney("18.00usd"), { amount: "18", currency: "USD" });
    assert.deepEqual(parseMoney("0.30"), { amount: "0.3", currency: null });
    for (const input of ["$18", "USD 18", "18,00 EUR", "18.00 US", "free"]) assert.equal(parseMoney(input), null, input);
  });
});

describe("dates", () => {
  test("ISO 8601 dates and date-times, with Google's offset styles", () => {
    assert.equal(parseDate("2026-12-01"), Date.UTC(2026, 11, 1));
    assert.equal(parseDate("2026-12-01T00:00-0800"), Date.UTC(2026, 11, 1, 8));
    assert.equal(parseDate("2026-12-01T13:00:00+05:30"), Date.UTC(2026, 11, 1, 7, 30));
    assert.equal(parseDate("2026-12-01T13:00:00.123Z"), Date.UTC(2026, 11, 1, 13));
    for (const input of ["next week", "2026-13-01", "2026-02-30", "2026-04-31T10:00Z", "2026-12-01 13:00", ""]) assert.equal(parseDate(input), null, input);
  });

  test("an end date without a time includes that whole day", () => {
    assert.equal(parseEndDate("2026-12-01"), Date.UTC(2026, 11, 2));
    assert.equal(parseEndDate("2026-12-01T15:30-0800"), Date.UTC(2026, 11, 1, 23, 30));
    assert.equal(parseEndDate("2026-02-30"), null);
  });
});

describe("availability values", () => {
  test("feed spellings", () => {
    assert.equal(availabilityOfFeed("in_stock"), "in_stock");
    assert.equal(availabilityOfFeed("In Stock"), "in_stock");
    assert.equal(availabilityOfFeed("pre_order"), "preorder");
    for (const input of ["unknown", "build_to_order", "", "yes"]) assert.equal(availabilityOfFeed(input), null, input);
  });

  test("schema.org values outside Google's mapping, and prototype names, are null", () => {
    for (const input of ["MadeToOrder", "Reserved", "constructor", "__proto__", "toString"]) assert.equal(availabilityOfSchema(input), null, input);
    assert.equal(availabilityOfSchema("SOLDOUT"), "out_of_stock");
  });
});
