import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseJson, type JsonNode } from "../src/json.ts";

function plain(node: JsonNode): unknown {
  if (node.kind === "object") return Object.fromEntries([...node.props].map(([k, v]) => [k, plain(v)]));
  if (node.kind === "array") return node.items.map(plain);
  return node.kind === "null" ? null : node.value;
}

function parsed(text: string): JsonNode {
  const r = parseJson(text);
  assert.ok(r.ok, r.ok ? "" : r.error);
  return r.value;
}

function error(text: string, firstLine = 1): { error: string; line: number } {
  const r = parseJson(text, firstLine);
  assert.equal(r.ok, false, `expected a parse error for ${JSON.stringify(text)}`);
  return r as { error: string; line: number };
}

describe("parseJson values", () => {
  test("matches JSON.parse on every value kind, escapes included", () => {
    const text = '{"s":"a\\"b\\\\c\\/d\\n\\t\\u00e9\\ud83d\\ude00","n":[0,-1.5,2e3,1E-2],"t":true,"f":false,"z":null,"o":{},"a":[]}';
    assert.deepEqual(plain(parsed(text)), JSON.parse(text));
  });

  test("records the line of every value, offset by firstLine", () => {
    const r = parseJson('{\n  "a": 1,\n  "b": [\n    "x"\n  ]\n}', 10);
    assert.ok(r.ok);
    assert.equal(r.value.line, 10);
    const obj = r.value as Extract<JsonNode, { kind: "object" }>;
    assert.equal(obj.props.get("a")?.line, 11);
    const b = obj.props.get("b") as Extract<JsonNode, { kind: "array" }>;
    assert.equal(b.line, 12);
    assert.equal(b.items[0].line, 13);
  });

  test("a repeated key keeps the last value, like JSON.parse, and is reported", () => {
    const r = parseJson('{"a": 1,\n"a": 2}');
    assert.ok(r.ok);
    assert.deepEqual(plain(r.value), { a: 2 });
    assert.deepEqual(r.duplicateKeys, [{ key: "a", line: 2 }]);
  });

  test("__proto__ is an ordinary key", () => {
    assert.deepEqual([...(parsed('{"__proto__": 1}') as Extract<JsonNode, { kind: "object" }>).props.keys()], ["__proto__"]);
  });
});

describe("parseJson errors", () => {
  const cases: [string, string, RegExp, number][] = [
    ["trailing comma in an object", '{\n"a": 1,\n}', /Trailing comma before "}"/, 3],
    ["trailing comma in an array", '[1,\n2,\n]', /Trailing comma before "]"/, 3],
    ["single quotes", "{'a': 1}", /double quotes, not single quotes/, 1],
    ["a comment", '{\n// note\n"a": 1}', /comments/, 2],
    ["an unquoted key", "{a: 1}", /Property names must be in double quotes/, 1],
    ["a raw line break in a string", '{"a": "one\ntwo"}', /Unescaped line break inside a string/, 1],
    ["a control character in a string", '{"a": "\u0001"}', /control character/, 1],
    ["an invalid escape", '{"a": "\\x"}', /Invalid escape "\\x"/, 1],
    ["a short \\u escape", '{"a": "\\u12"}', /four hex digits/, 1],
    ["a missing comma", '{"a": 1\n"b": 2}', /Expected "," or "}" after the value of "a"/, 2],
    ["a missing comma in an array", "[1 2]", /Expected "," or "]"/, 1],
    ["a missing colon", '{"a" 1}', /Expected ":"/, 1],
    ["an unterminated string", '{"a": "b', /Unterminated string/, 1],
    ["unexpected end", '{"a": [1,\n2', /Unexpected end of input/, 2],
    ["a second value", '{"a": 1}\n{"b": 2}', /A second JSON value follows/, 2],
    ["text after the value", '{"a": 1} x', /after the end of the JSON/, 1],
    ["a leading zero", '{"a": 01}', /Expected "," or "}"/, 1],
    ["NaN", '{"a": NaN}', /Unexpected "N"/, 1],
    ["empty input", "  ", /Unexpected end of input/, 1],
  ];
  for (const [name, text, message, line] of cases) {
    test(name, () => {
      const e = error(text);
      assert.match(e.error, message);
      assert.equal(e.line, line);
    });
  }

  test("JSON.parse rejects every case too", () => {
    for (const [, text] of cases) assert.throws(() => JSON.parse(text));
  });

  test("error lines are offset by firstLine", () => {
    assert.equal(error('{\n"a": 1,\n}', 40).line, 42);
  });

  test("deep nesting is an error, not a stack overflow", () => {
    assert.match(error("[".repeat(10_000)).error, /Nested more than/);
  });
});
