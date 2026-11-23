import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { gtinCheckDigit } from "../src/gtin.ts";
import { isbn10CheckDigit, isbn10To13, isbn13To10, isValidIsbn, validateIsbn } from "../src/isbn.ts";

// Published examples from Wikipedia's "ISBN" article: 0-306-40615-2 and its ISBN-13 form
// 978-0-306-40615-7, and 0-8044-2957-X, an ISBN-10 whose check character is X.
const ISBN10 = "0306406152";
const ISBN13 = "9780306406157";
const ISBN10_X = "080442957X";

describe("isbn10CheckDigit", () => {
  test("matches the published examples, including X for 10", () => {
    assert.equal(isbn10CheckDigit("030640615"), "2");
    assert.equal(isbn10CheckDigit("080442957"), "X");
  });

  test("returns null unless given exactly nine digits", () => {
    assert.equal(isbn10CheckDigit("03064061"), null);
    assert.equal(isbn10CheckDigit("03064061X"), null);
  });
});

describe("validateIsbn", () => {
  test("ISBN-10: valid, with its ISBN-13 form", () => {
    const r = validateIsbn("0-306-40615-2");
    assert.equal(r.kind, "ISBN-10");
    assert.equal(r.valid, true);
    assert.equal(r.isbn10, ISBN10);
    assert.equal(r.isbn13, ISBN13);
  });

  test("ISBN-10 with an X check character, in either case", () => {
    assert.equal(validateIsbn(ISBN10_X).valid, true);
    assert.equal(validateIsbn("0-8044-2957-x").valid, true);
  });

  test("ISBN-13 with prefix 978: valid, with its ISBN-10 form", () => {
    const r = validateIsbn("978-0-306-40615-7");
    assert.equal(r.kind, "ISBN-13");
    assert.equal(r.valid, true);
    assert.equal(r.isbn10, ISBN10);
  });

  test("ISBN-13 with prefix 979: valid, no ISBN-10 form", () => {
    const body = "979109063607";
    const isbn = body + gtinCheckDigit(body);
    const r = validateIsbn(isbn);
    assert.equal(r.valid, true);
    assert.equal(r.isbn13, isbn);
    assert.equal(r.isbn10, null);
  });

  test("a GTIN-13 outside 978/979 fails the prefix check even with a correct check digit", () => {
    const r = validateIsbn("4006381333931");
    assert.equal(r.valid, false);
    assert.deepEqual(r.checks.map((c) => [c.id, c.status]), [
      ["format", "pass"],
      ["prefix", "fail"],
      ["checksum", "pass"],
    ]);
  });

  test("rejects every single-digit change of the published ISBN-10 and ISBN-13", () => {
    for (const code of [ISBN10, ISBN13]) {
      for (let i = 0; i < code.length; i++) {
        for (let d = 0; d <= 9; d++) {
          if (String(d) === code[i]) continue;
          const changed = code.slice(0, i) + d + code.slice(i + 1);
          assert.equal(isValidIsbn(changed), false, changed);
        }
      }
    }
  });

  test("rejects an ISBN-10 with two adjacent digits swapped", () => {
    assert.equal(isValidIsbn("3006406152"), false);
  });

  test("an X anywhere but the last position is a format failure", () => {
    const r = validateIsbn("03064X6152");
    assert.equal(r.kind, null);
    assert.deepEqual(r.checks.map((c) => c.status), ["fail", "skipped", "skipped"]);
  });

  test("empty and wrong-length input fail cleanly", () => {
    assert.equal(validateIsbn("").checks[0].detail, "Nothing to check.");
    assert.equal(validateIsbn("12345").valid, false);
  });

  test("every check is reported, always in the same order", () => {
    for (const input of ["", "abc", ISBN10, ISBN13, "4006381333931"]) {
      assert.deepEqual(validateIsbn(input).checks.map((c) => c.id), ["format", "prefix", "checksum"]);
    }
  });
});

describe("isbn10To13 / isbn13To10", () => {
  test("convert the published pair both ways", () => {
    assert.deepEqual(isbn10To13(ISBN10), { ok: true, value: ISBN13 });
    assert.deepEqual(isbn13To10(ISBN13), { ok: true, value: ISBN10 });
  });

  test("round-trip an X check character", () => {
    const to13 = isbn10To13(ISBN10_X);
    assert.equal(to13.ok, true);
    if (to13.ok) assert.deepEqual(isbn13To10(to13.value), { ok: true, value: ISBN10_X });
  });

  test("refuse a 979 ISBN-13, which has no ISBN-10 form", () => {
    const body = "979109063607";
    const r = isbn13To10(body + gtinCheckDigit(body));
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /979/);
  });

  test("refuse the wrong kind of input", () => {
    assert.equal(isbn10To13(ISBN13).ok, false);
    assert.equal(isbn13To10(ISBN10).ok, false);
  });

  test("refuse a bad check digit with the reason", () => {
    const r = isbn10To13("0306406153");
    assert.equal(r.ok, false);
    if (!r.ok) assert.match(r.error, /check digit for the rest is 2/);
  });
});
