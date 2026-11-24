import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseXml, type XmlElement, type XmlParseResult } from "../src/xml.ts";

function ok(input: string): XmlElement {
  const r = parseXml(input);
  assert.equal(r.ok, true, r.ok ? "" : `${r.error} (line ${r.line})`);
  return (r as Extract<XmlParseResult, { ok: true }>).root;
}

function fails(input: string, pattern: RegExp, line?: number): void {
  const r = parseXml(input);
  assert.equal(r.ok, false, "expected a parse error");
  if (r.ok) return;
  assert.match(r.error, pattern);
  if (line !== undefined) assert.equal(r.line, line);
}

describe("parseXml: structure", () => {
  test("builds the tree with names, namespaces, text and line numbers", () => {
    const root = ok(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="urn:a" xmlns:i="urn:i">\n  <url>\n    <loc>x</loc>\n    <i:image/>\n  </url>\n</urlset>`);
    assert.equal(root.localName, "urlset");
    assert.equal(root.namespace, "urn:a");
    assert.equal(root.line, 2);
    const url = root.children[0];
    assert.equal(url.line, 3);
    assert.equal(url.children[0].text, "x");
    assert.equal(url.children[0].line, 4);
    assert.equal(url.children[1].name, "i:image");
    assert.equal(url.children[1].localName, "image");
    assert.equal(url.children[1].namespace, "urn:i");
  });

  test("reports the declared encoding and a skipped DOCTYPE", () => {
    const r = parseXml(`<?xml version="1.0" encoding="ISO-8859-1"?><!DOCTYPE x><x/>`);
    assert.equal(r.ok && r.declaredEncoding, "ISO-8859-1");
    assert.equal(r.ok && r.doctype, true);
  });

  test("ignores a byte order mark, comments and processing instructions", () => {
    assert.equal(ok("﻿<?xml version=\"1.0\"?><!-- c --><x><?pi data?><!-- c --></x><!-- after -->").name, "x");
  });

  test("decodes predefined entities and character references", () => {
    assert.equal(ok("<x>a&amp;b&lt;&gt;&quot;&apos;&#65;&#x42;&#x1F600;</x>").text, "a&b<>\"'AB\u{1F600}");
  });

  test("keeps CDATA content raw", () => {
    assert.equal(ok("<x><![CDATA[a & b <c>]]></x>").text, "a & b <c>");
  });

  test("decodes attribute values and accepts both quote styles", () => {
    assert.deepEqual(ok(`<x a="1 &amp; 2" b='"q"'/>`).attributes, { a: "1 & 2", b: '"q"' });
  });

  test("xmlns=\"\" undeclares the default namespace", () => {
    const root = ok(`<a xmlns="urn:a"><b xmlns=""/></a>`);
    assert.equal(root.children[0].namespace, null);
  });

  test("CRLF line endings count lines correctly", () => {
    assert.equal(ok("<a>\r\n<b/>\r\n<c/></a>").children[1].line, 3);
  });
});

describe("parseXml: well-formedness errors", () => {
  test("an unescaped & names the line and the fix", () => {
    fails("<urlset>\n<url>\n<loc>https://a.example/?a=1&b=2</loc>\n</url>\n</urlset>", /Unescaped "&".*&amp;/, 3);
  });

  test("mismatched closing tag names both tags and the opening line", () => {
    fails("<a>\n<b>\n</a>", /Expected <\/b> \(opened on line 2\) but found <\/a>/, 3);
  });

  test("unclosed element", () => fails("<a><b></b>", /<a> \(opened on line 1\) is never closed/));
  test("closing tag without an opening tag", () => fails("<a></a></b>", /no matching opening tag/));
  test("two root elements", () => fails("<a/><b/>", /second root element/));
  test("text before the root", () => fails("hello <a/>", /Text before the root/));
  test("text after the root", () => fails("<a/> hello", /Text after the root/));
  test("no root at all", () => fails("<?xml version=\"1.0\"?>", /No root element/));
  test("empty input", () => fails("", /No root element/));
  test("XML declaration not at the start", () => fails(" <?xml version=\"1.0\"?><a/>", /very start/));
  test("unterminated comment", () => fails("<a><!-- x</a>", /Unterminated comment/));
  test("unterminated CDATA", () => fails("<a><![CDATA[x</a>", /Unterminated CDATA/));
  test("unterminated start tag", () => fails("<a b=\"1\"", /Unterminated (start tag|value)/));
  test("unquoted attribute value", () => fails("<a b=1/>", /must be in quotes/));
  test("attribute without a value", () => fails("<a b/>", /needs a value/));
  test("duplicate attribute", () => fails("<a b=\"1\" b=\"2\"/>", /appears twice/));
  test("< inside an attribute value", () => fails("<a b=\"<\"/>", /not allowed in an attribute value/));
  test("missing space between attributes", () => fails("<a b=\"1\"c=\"2\"/>", /Expected a space/));
  test("undeclared namespace prefix", () => fails("<a><x:b/></a>", /prefix "x".*not declared/));
  test("undeclared attribute prefix", () => fails("<a x:b=\"1\"/>", /prefix "x".*not declared/));
  test("control characters are rejected", () => fails("<a>bad\u0001char</a>", /U\+0001/));
  test("character references to disallowed characters are rejected", () => fails("<a>&#0;</a>", /not a character allowed/));
  test("an invalid start of tag", () => fails("<a>< b/></a>", /Expected element name/));
});

describe("parseXml: entity attacks", () => {
  test("an external entity (XXE) is never resolved", () => {
    const xxe = `<?xml version="1.0"?>\n<!DOCTYPE urlset [<!ENTITY xxe SYSTEM "file:///etc/passwd">]>\n<urlset><url><loc>&xxe;</loc></url></urlset>`;
    fails(xxe, /Undefined entity &xxe;/, 3);
  });

  test("entity expansion (billion laughs) is never performed", () => {
    const lol = `<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol2 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;">]><lolz>&lol2;</lolz>`;
    fails(lol, /Undefined entity &lol2;/);
  });

  test("a DOCTYPE after the root element is an error", () => fails("<a/><!DOCTYPE a>", /DOCTYPE must come before/));
  test("an unterminated DOCTYPE is an error", () => fails("<!DOCTYPE a [ <!ENTITY x \"]\"> ", /Unterminated DOCTYPE/));
});
