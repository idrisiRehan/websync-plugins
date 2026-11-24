import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { extractJsonLd } from "../src/extract.ts";

describe("format detection", () => {
  test("an object or array is raw JSON-LD, after whitespace or a BOM", () => {
    for (const input of ['{"@type":"Thing"}', '\n  [{"@type":"Thing"}]', '\ufeff{"a":1}']) {
      const r = extractJsonLd(input);
      assert.equal(r.format, "json", input);
      assert.equal(r.blocks.length, 1);
      assert.equal(r.blocks[0].line, 1);
    }
  });

  test("anything else is HTML", () => {
    assert.equal(extractJsonLd("<!doctype html><p>hi</p>").format, "html");
    assert.equal(extractJsonLd("").format, "html");
  });
});

describe("JSON-LD scripts in HTML", () => {
  test("finds each script and the line its content starts on", () => {
    const html = '<html><head>\n<script type="application/ld+json">{"a":1}</script>\n<script type="application/ld+json">\n{"b":2}\n</script>';
    const { blocks } = extractJsonLd(html);
    assert.deepEqual(
      blocks.map((b) => [b.text, b.line, b.scriptLine]),
      [
        ['{"a":1}', 2, 2],
        ['\n{"b":2}\n', 3, 3],
      ],
    );
  });

  test("matches the type case-insensitively and allows parameters", () => {
    for (const type of ["APPLICATION/LD+JSON", " application/ld+json ", "application/ld+json; charset=utf-8", "application/ld+json;profile=x"]) {
      assert.equal(extractJsonLd(`<script type="${type}">{}</script>`).blocks.length, 1, type);
    }
  });

  test("ignores other scripts and look-alike types", () => {
    const html = '<script>var a = {"@type":"Product"};</script><script type="application/json">{}</script><script type="application/ld+json+x">{}</script>';
    assert.deepEqual(extractJsonLd(html).blocks, []);
  });

  test("an empty script is a block with no text", () => {
    const { blocks } = extractJsonLd('<p>\n<script type="application/ld+json"></script>');
    assert.deepEqual(blocks, [{ text: "", line: 2, scriptLine: 2 }]);
  });

  test("script content is not entity-decoded, as in browsers", () => {
    const { blocks } = extractJsonLd('<script type="application/ld+json">{"name":"A &amp; B"}</script>');
    assert.equal(blocks[0].text, '{"name":"A &amp; B"}');
  });

  test("an unclosed script runs to the end of the input", () => {
    assert.equal(extractJsonLd('<script type="application/ld+json">{"a":1}').blocks[0].text, '{"a":1}');
  });

  test("notes Microdata and RDFa, which aren't checked", () => {
    assert.equal(extractJsonLd('<div itemscope itemtype="https://schema.org/Product"></div>').otherSyntax, true);
    assert.equal(extractJsonLd('<div vocab="https://schema.org/" typeof="Product"></div>').otherSyntax, true);
    assert.equal(extractJsonLd("<div></div>").otherSyntax, false);
  });
});
