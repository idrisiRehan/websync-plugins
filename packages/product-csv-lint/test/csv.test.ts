import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { detectDelimiter, parseCsv } from "../src/csv.ts";

const cells = (text: string, d: "," | ";" = ",") => parseCsv(text, d).records.map((r) => r.cells);

describe("parseCsv", () => {
  test("splits fields and rows, with LF, CRLF and CR line endings", () => {
    assert.deepEqual(cells("a,b\n1,2"), [["a", "b"], ["1", "2"]]);
    assert.deepEqual(cells("a,b\r\n1,2\r\n"), [["a", "b"], ["1", "2"]]);
    assert.deepEqual(cells("a,b\r1,2"), [["a", "b"], ["1", "2"]]);
  });

  test("quoted fields keep commas, newlines and doubled quotes", () => {
    assert.deepEqual(cells('a,b\n"x, y","line1\nline2"\n"say ""hi""",z'), [["a", "b"], ["x, y", "line1\nline2"], ['say "hi"', "z"]]);
  });

  test("row numbers follow records, so a multi-line cell takes one row", () => {
    const { records } = parseCsv('h\n"a\nb"\nc', ",");
    assert.deepEqual(records.map((r) => r.row), [1, 2, 3]);
  });

  test("blank lines are skipped but still counted", () => {
    const { records } = parseCsv("h\n\n1\n   \n2", ",");
    assert.deepEqual(records.map((r) => [r.row, r.cells[0]]), [[1, "h"], [3, "1"], [5, "2"]]);
  });

  test("an empty quoted field is kept as a row", () => {
    assert.deepEqual(cells('h\n""'), [["h"], [""]]);
  });

  test("a quote inside an unquoted field is kept literally and reported", () => {
    const r = parseCsv('t\n12" pizza,x', ",");
    assert.deepEqual(r.records[1].cells, ['12" pizza', "x"]);
    assert.deepEqual(r.issues, [{ kind: "quote-unexpected", row: 2 }]);
  });

  test("text after a closing quote is reported", () => {
    assert.deepEqual(parseCsv('t\n"a"b', ",").issues, [{ kind: "quote-unexpected", row: 2 }]);
  });

  test("an unterminated quote is reported on the row where it opened", () => {
    assert.deepEqual(parseCsv('t\nok\n"never closed\nmore', ",").issues, [{ kind: "quote-unterminated", row: 3 }]);
  });

  test("semicolon delimiter", () => {
    assert.deepEqual(cells("a;b\n1,5;2", ";"), [["a", "b"], ["1,5", "2"]]);
  });
});

describe("detectDelimiter", () => {
  test("comma by default, semicolon when it dominates the first line", () => {
    assert.equal(detectDelimiter("a,b,c\n1;2;3;4;5"), ",");
    assert.equal(detectDelimiter("a;b;c\n1,2"), ";");
    assert.equal(detectDelimiter('"a;b;c",d'), ",");
    assert.equal(detectDelimiter("single"), ",");
  });
});
