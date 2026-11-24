import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { charLength, fitId, htmlToText, oneLine, truncateWords } from "../src/text.ts";

describe("htmlToText", () => {
  test("drops tags, keeps text, and breaks lines at blocks only", () => {
    assert.equal(htmlToText("<p>Hello <strong>bold</strong> <em>world</em></p>"), "Hello bold world");
    assert.equal(htmlToText("<div>a</div><div>b</div>"), "a\nb");
    assert.equal(htmlToText("<p>one</p>\n\n   <p>two</p>"), "one\ntwo");
    assert.equal(htmlToText("<span>in</span><span>line</span>"), "inline");
  });

  test("decodes entities in HTML, including non-breaking spaces", () => {
    assert.equal(htmlToText("<p>Fish &amp; chips&nbsp;&#36;5 &lt;3</p>"), "Fish & chips $5 <3");
  });

  test("leaves out script, style, noscript and template content, and comments", () => {
    assert.equal(htmlToText("<p>a</p><script>var x = '<p>no</p>';</script><style>.x{}</style><noscript><img src=x></noscript><template><p>no</p></template><!-- note --><p>b</p>"), "a\nb");
  });

  test("plain text keeps its line breaks; its entities are decoded, since the field is HTML", () => {
    assert.equal(htmlToText("Line one\r\nLine two\n\n  Line three  "), "Line one\nLine two\nLine three");
    assert.equal(htmlToText("Size < 10 & light"), "Size < 10 & light");
    // The storefront renders the field as HTML, so shoppers read "Fish & Chips".
    assert.equal(htmlToText("Fish &amp; Chips &#36;5&nbsp;each"), "Fish & Chips $5 each");
  });

  test("never throws on broken markup", () => {
    for (const html of ["<p>open", "<", "<p", "</>", "<a href='x>text", "<!--", "<script>never closed", "&#xFFFFFF; &#0;", "<<<>>>"]) {
      assert.equal(typeof htmlToText(html), "string");
    }
  });
});

describe("oneLine", () => {
  test("collapses white space and removes control characters", () => {
    assert.equal(oneLine(`  a${String.fromCharCode(9)}b\n\nc ${String.fromCharCode(0)}d${String.fromCharCode(0x7f)} `), "a b c d");
  });
});

describe("lengths", () => {
  test("characters are code points", () => {
    assert.equal(charLength("mug"), 3);
    assert.equal(charLength("\u{1F375}mug"), 4);
  });

  test("truncateWords cuts at the last word boundary within the limit", () => {
    assert.equal(truncateWords("short", 10), "short");
    assert.equal(truncateWords("one two three", 9), "one two");
    assert.equal(truncateWords("one two three", 7), "one two");
    assert.equal(truncateWords("one two three", 8), "one two");
    assert.equal(truncateWords("abcdefghij", 4), "abcd");
    assert.equal(truncateWords("\u{1F375}\u{1F375}\u{1F375} tea", 2), "\u{1F375}\u{1F375}");
  });

  test("fitId keeps short ids and shortens long ones stably and distinctly", () => {
    assert.equal(fitId("MUG-1", 50), "MUG-1");
    assert.equal(fitId("x".repeat(50), 50), "x".repeat(50));
    const a = fitId(`${"x".repeat(60)}a`, 50);
    const b = fitId(`${"x".repeat(60)}b`, 50);
    assert.equal(charLength(a), 50);
    assert.notEqual(a, b);
    assert.equal(a, fitId(`${"x".repeat(60)}a`, 50));
    assert.equal(charLength(fitId("\u{1F375}".repeat(60), 50)), 50);
  });
});
