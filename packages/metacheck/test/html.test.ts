import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { decodeEntities, tokenizeHtml, type HtmlToken } from "../src/html.ts";

const starts = (html: string) => tokenizeHtml(html).filter((t) => t.type === "start");
const attrsOf = (html: string) => (starts(html)[0] as Extract<HtmlToken, { type: "start" }>).attrs;
const texts = (html: string) => tokenizeHtml(html).filter((t) => t.type === "text").map((t) => t.text);

describe("tags and attributes", () => {
  test("lowercases tag and attribute names", () => {
    assert.deepEqual(tokenizeHtml('<META NAME="Description" Content="x">'), [
      { type: "start", tag: "meta", attrs: Object.assign(Object.create(null), { name: "Description", content: "x" }), selfClosing: false, line: 1 },
    ]);
  });

  test("reads double-quoted, single-quoted, unquoted and empty values", () => {
    const attrs = attrsOf(`<a href="/x y" title='it"s' data-n=5 hidden rel = nofollow>`);
    assert.deepEqual({ ...attrs }, { href: "/x y", title: 'it"s', "data-n": "5", hidden: "", rel: "nofollow" });
  });

  test("keeps the first of a repeated attribute, as browsers do", () => {
    assert.equal(attrsOf('<meta content="first" content="second">').content, "first");
  });

  test("decodes character references in attribute values", () => {
    assert.equal(attrsOf('<a href="/?a=1&amp;b=2&#38;c=&#x33;">').href, "/?a=1&b=2&c=3");
  });

  test("an attribute named __proto__ is stored, not used as a prototype", () => {
    const attrs = attrsOf('<div __proto__="x" constructor="y">');
    assert.equal(attrs["__proto__"], "x");
    assert.equal(attrs.constructor, "y");
    assert.equal(Object.getPrototypeOf(attrs), null);
  });

  test("self-closing only when the slash is right before >", () => {
    assert.equal((starts("<br/>")[0] as { selfClosing: boolean }).selfClosing, true);
    assert.equal((starts('<link href="a" />')[0] as { selfClosing: boolean }).selfClosing, true);
    assert.equal((starts("<br/ >")[0] as { selfClosing: boolean }).selfClosing, false);
    assert.equal((starts("<a / href=x>")[0] as { selfClosing: boolean }).selfClosing, false);
  });

  test("end tags ignore attributes", () => {
    assert.deepEqual(tokenizeHtml('</DIV class="x>y">'), [{ type: "end", tag: "div", line: 1 }]);
  });

  test("a > inside a quoted value does not close the tag", () => {
    assert.equal(attrsOf('<meta content="a > b">').content, "a > b");
  });
});

describe("text and character references", () => {
  test("decodes common named and numeric references", () => {
    assert.equal(decodeEntities("&lt;b&gt; &amp; &quot;q&quot; &nbsp;&copy;&#169;&#xA9;"), '<b> & "q" \u00A0\u00A9\u00A9\u00A9');
  });

  test("decodes typographic dashes and quotes", () => {
    assert.equal(decodeEntities("&ndash;&mdash;&lsquo;&rsquo;&ldquo;&rdquo;&hellip;"), "\u2013\u2014\u2018\u2019\u201C\u201D\u2026");
  });

  test("leaves unknown names and bare ampersands alone", () => {
    assert.equal(decodeEntities("Tom & Jerry &unknown; &amp"), "Tom & Jerry &unknown; &amp");
  });

  test("invalid code points become U+FFFD", () => {
    assert.equal(decodeEntities("&#0;&#xD800;&#x110000;&#99999999999;"), "\uFFFD\uFFFD\uFFFD\uFFFD");
  });

  test("a < that starts no markup is text", () => {
    assert.deepEqual(texts("a < b <3 <>"), ["a < b <3 <>"]);
  });

  test("text around a comment is merged into one token", () => {
    assert.deepEqual(texts("Hello <!-- note --> world"), ["Hello  world"]);
  });
});

describe("comments, doctype and bogus markup", () => {
  test("drops comments, including markup inside them", () => {
    assert.deepEqual(starts('<!-- <meta name="x"> --><p>'), [{ type: "start", tag: "p", attrs: Object.create(null), selfClosing: false, line: 1 }]);
  });

  test("abruptly closed comments <!--> and <!--->", () => {
    assert.deepEqual(texts("a<!-->b<!--->c"), ["abc"]);
  });

  test("--!> closes a comment, as in browsers", () => {
    assert.deepEqual(texts("a<!-- x --!>b<!-- y -->c"), ["abc"]);
  });

  test("an unclosed comment runs to the end", () => {
    assert.deepEqual(tokenizeHtml("<p><!-- <title>x</title>"), [{ type: "start", tag: "p", attrs: Object.create(null), selfClosing: false, line: 1 }]);
  });

  test("reads the doctype", () => {
    assert.deepEqual(tokenizeHtml("<!DOCTYPE html>")[0], { type: "doctype", value: "html", line: 1 });
    assert.deepEqual(tokenizeHtml("<!doctype html")[0], { type: "doctype", value: "html", line: 1 });
  });

  test("drops processing instructions, CDATA and </ followed by a non-letter", () => {
    assert.deepEqual(texts("a<?xml version='1.0'?>b<![CDATA[x]]>c</>d</ 1>e"), ["abcde"]);
  });
});

describe("raw text elements", () => {
  test("script content is one text token, markup inside is not parsed", () => {
    const tokens = tokenizeHtml('<script>if (a < b) document.write("<meta name=x>")</script><p>');
    assert.deepEqual(tokens.map((t) => t.type), ["start", "text", "end", "start"]);
    assert.equal((tokens[1] as { text: string }).text, 'if (a < b) document.write("<meta name=x>")');
  });

  test("script and style content is not entity-decoded; title is", () => {
    assert.deepEqual(texts("<script>a &amp; b</script><style>c &amp; d</style><title>e &amp; f</title>"), ["a &amp; b", "c &amp; d", "e & f"]);
  });

  test("the end tag match is case-insensitive and needs a delimiter", () => {
    assert.deepEqual(texts("<title>a</titles> b</TITLE >"), ["a</titles> b"]);
  });

  test("JSON-LD survives intact", () => {
    const json = '{"@context":"https://schema.org","name":"A <b> & C"}';
    assert.deepEqual(texts(`<script type="application/ld+json">${json}</script>`), [json]);
  });

  test("an unclosed script takes the rest of the input as text", () => {
    assert.deepEqual(tokenizeHtml("<script>var x = 1; <p>").map((t) => t.type), ["start", "text"]);
  });
});

describe("robustness", () => {
  test("input ending inside a tag drops the tag", () => {
    assert.deepEqual(tokenizeHtml('text<meta content="x'), [{ type: "text", text: "text", line: 1 }]);
    assert.deepEqual(tokenizeHtml("text</div"), [{ type: "text", text: "text", line: 1 }]);
  });

  test("skips a byte order mark", () => {
    assert.deepEqual(tokenizeHtml("\uFEFF<!doctype html>")[0], { type: "doctype", value: "html", line: 1 });
  });

  test("line numbers count newlines, including inside attributes and raw text", () => {
    const tokens = tokenizeHtml('<html>\n<head>\n<meta\n  name="a">\n<script>\n\n</script>\n<title>t</title>');
    const lines = tokens.filter((t) => t.type !== "text").map((t) => [t.type === "end" ? `/${t.tag}` : (t as { tag: string }).tag, t.line]);
    assert.deepEqual(lines, [["html", 1], ["head", 2], ["meta", 3], ["script", 5], ["/script", 7], ["title", 8], ["/title", 8]]);
  });

  test("a large single-line document tokenizes in linear time", () => {
    const html = "<div class=a>x</div>".repeat(100_000);
    const started = performance.now();
    assert.equal(tokenizeHtml(html).length, 300_000);
    assert.ok(performance.now() - started < 2000);
  });

  test("never throws on arbitrary input", () => {
    const pieces = ["<", ">", "/", "!", "--", "a", "=", '"', "'", "&", "#", ";", " ", "\n", "script", "title", "?"];
    let seed = 7;
    for (let i = 0; i < 5000; i++) {
      let s = "";
      for (let j = 0; j < 20; j++) {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        s += pieces[seed % pieces.length];
      }
      tokenizeHtml(s);
    }
  });
});

describe("browser compatibility details", () => {
  test("numeric references to 0x80-0x9F decode as windows-1252, as in browsers", () => {
    assert.deepEqual([...decodeEntities("&#128;&#x93;&#150;&#x81;")].map((c) => c.codePointAt(0)), [0x20ac, 0x201c, 0x2013, 0x81]);
  });

  test("noscript content is raw text, so an unclosed comment inside it hides nothing after it", () => {
    const tokens = tokenizeHtml("<noscript><!-- <img src=x></noscript><title>t</title>");
    assert.deepEqual(tokens.map((t) => t.type), ["start", "text", "end", "start", "text", "end"]);
    assert.equal((tokens[1] as { text: string }).text, "<!-- <img src=x>");
  });
});
