import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lintLlmsTxt, type LlmsTxtResult, type RuleId } from "../src/lint.ts";

const example = (name: string) => readFileSync(new URL(`../examples/${name}`, import.meta.url), "utf8");

function rules(result: LlmsTxtResult): RuleId[] {
  return result.findings.map((f) => f.rule);
}

function only(result: LlmsTxtResult, rule: RuleId) {
  const found = result.findings.filter((f) => f.rule === rule);
  assert.equal(found.length, 1, `expected one ${rule}, got: ${JSON.stringify(result.findings)}`);
  return found[0];
}

// The mock example from https://llmstxt.org/#format.
const SPEC_MOCK = `# Title

> Optional description goes here

Optional details go here

## Section name

- [Link title](https://link_url): Optional link details

## Optional

- [Link title](https://link_url)
`;

describe("valid files", () => {
  test("the spec's mock example parses, flagging only its repeated placeholder URL", () => {
    const r = lintLlmsTxt(SPEC_MOCK);
    assert.deepEqual(r.findings.map((f) => [f.rule, f.line]), [["url-duplicate", 13]]);
    assert.equal(r.valid, true);
    assert.deepEqual(r.doc, {
      title: "Title",
      summary: "Optional description goes here",
      details: "Optional details go here",
      sections: [
        { title: "Section name", optional: false, line: 7, links: [{ title: "Link title", url: "https://link_url", notes: "Optional link details", line: 9 }] },
        { title: "Optional", optional: true, line: 11, links: [{ title: "Link title", url: "https://link_url", notes: null, line: 13 }] },
      ],
    });
  });

  test("the example llms.txt is clean", () => {
    const r = lintLlmsTxt(example("llms.txt"));
    assert.deepEqual(r.findings, []);
    assert.equal(r.doc.sections.length, 3);
  });

  test("an H1 alone is a complete file", () => {
    const r = lintLlmsTxt("# Just a name\n");
    assert.deepEqual(r.findings, []);
    assert.deepEqual(r.doc, { title: "Just a name", summary: null, details: null, sections: [] });
  });

  test("a byte-order mark and CRLF line endings are accepted", () => {
    const r = lintLlmsTxt(`\uFEFF${SPEC_MOCK.replace(/\n/g, "\r\n")}`);
    assert.deepEqual(r.findings.map((f) => f.rule), ["url-duplicate"]);
    assert.equal(r.doc.title, "Title");
    assert.equal(r.doc.sections[0].links[0].line, 9);
  });

  test("relative URLs are allowed", () => {
    const r = lintLlmsTxt("# T\n\n## Docs\n\n- [A](/a.md)\n- [B](b.md)\n- [C](../c.md)\n");
    assert.deepEqual(r.findings, []);
    assert.deepEqual(r.doc.sections[0].links.map((l) => l.url), ["/a.md", "b.md", "../c.md"]);
  });
});

describe("parsing", () => {
  test("a multi-line summary keeps its lines", () => {
    const r = lintLlmsTxt("# T\n> first line\n> second line\n>\n> after a break\n\nDetails.\n");
    assert.equal(r.doc.summary, "first line\nsecond line\n\nafter a break");
    assert.equal(r.doc.details, "Details.");
  });

  test("details keep their markdown as written, including lists and code", () => {
    const details = "Notes:\n\n- one\n- [a link](https://e.com/)\n\n```sh\n# a comment, not a heading\n## nor a section\n```";
    const r = lintLlmsTxt(`# T\n\n${details}\n\n## Docs\n\n- [A](https://e.com/a)\n`);
    assert.deepEqual(r.findings, []);
    assert.equal(r.doc.details, details);
    assert.equal(r.doc.sections.length, 1);
  });

  test("a tilde fence also hides headings", () => {
    assert.deepEqual(lintLlmsTxt("# T\n\n~~~\n### not a heading\n~~~\n").findings, []);
  });

  test("other list markers and ordered lists are read as links", () => {
    const r = lintLlmsTxt("# T\n\n## Docs\n\n* [A](https://e.com/a)\n+ [B](https://e.com/b)\n1. [C](https://e.com/c)\n2) [D](https://e.com/d)\n  - [E](https://e.com/e): nested\n");
    assert.deepEqual(r.findings, []);
    assert.deepEqual(r.doc.sections[0].links.map((l) => l.title), ["A", "B", "C", "D", "E"]);
  });

  test("notes: spacing around the colon, empty notes, and colons inside notes", () => {
    const r = lintLlmsTxt("# T\n\n## Docs\n\n- [A](https://e.com/a) :  spaced\n- [B](https://e.com/b):\n- [C](https://e.com/c): see: this\n");
    assert.deepEqual(r.findings, []);
    assert.deepEqual(r.doc.sections[0].links.map((l) => l.notes), ["spaced", null, "see: this"]);
  });

  test("URLs with balanced parentheses", () => {
    const r = lintLlmsTxt("# T\n\n## Docs\n\n- [W](https://en.wikipedia.org/wiki/Markdown_(language)): article\n");
    assert.deepEqual(r.findings, []);
    assert.equal(r.doc.sections[0].links[0].url, "https://en.wikipedia.org/wiki/Markdown_(language)");
  });

  test("closing hashes on a heading are not part of its text", () => {
    assert.equal(lintLlmsTxt("# Title ##\n").doc.title, "Title");
    assert.equal(lintLlmsTxt("# C#\n").doc.title, "C#");
  });

  test("U+2028 and U+2029 are ordinary characters, not line breaks", () => {
    const [ls, ps] = [String.fromCharCode(0x2028), String.fromCharCode(0x2029)];
    const r = lintLlmsTxt(`# Foo${ls}bar\n\n## Docs\n\n- [A](https://e.com/a): one${ps}two\n`);
    assert.deepEqual(r.findings, []);
    assert.equal(r.doc.title, `Foo${ls}bar`);
    assert.equal(r.doc.sections[0].links[0].notes, `one${ps}two`);
  });

  test("a line starting with an inline code span doesn't open a fence", () => {
    const r = lintLlmsTxt("# T\n\n```npm test``` runs the suite.\n\n## Docs\n\n- [A](https://e.com/a)\n");
    assert.deepEqual(r.findings, []);
    assert.equal(r.doc.details, "```npm test``` runs the suite.");
    assert.equal(r.doc.sections.length, 1);
  });

  test("long runs of spaces and long titles stay linear", () => {
    const start = performance.now();
    lintLlmsTxt(`# a${" ".repeat(200_000)}b\n\n## ${"x".repeat(1_000_000)}\n\n-${" ".repeat(200_000)}${String.fromCharCode(0x2028)}\n`);
    assert.ok(performance.now() - start < 1000, "took over a second");
  });

  test("findings are sorted by line", () => {
    const lines = lintLlmsTxt(example("llms-with-problems.txt")).findings.map((f) => f.line ?? 0);
    assert.deepEqual(lines, [...lines].sort((a, b) => a - b));
  });

  test("an invalid options.url throws", () => {
    assert.throws(() => lintLlmsTxt("# T\n", { url: "not a url" }), TypeError);
  });
});

describe("file rules", () => {
  test("file-empty", () => {
    for (const text of ["", "\n\n  \n", "\uFEFF"]) {
      const r = lintLlmsTxt(text);
      assert.deepEqual(rules(r), ["file-empty"]);
      assert.equal(r.findings[0].severity, "error");
      assert.equal(r.valid, false);
    }
  });

  test("file-html: an HTML 404 page served as llms.txt", () => {
    for (const text of ["<!DOCTYPE html>\n<html><body><h1>404</h1></body></html>", "\n<html lang=\"en\">", "<head>\n<title>x</title>"]) {
      const r = lintLlmsTxt(text);
      assert.deepEqual(rules(r), ["file-html"]);
      assert.equal(r.findings[0].severity, "error");
    }
  });

  test("markdown that starts with an HTML comment is not file-html", () => {
    assert.deepEqual(rules(lintLlmsTxt("<!-- generated -->\n# T\n")), ["h1-not-first"]);
  });
});

describe("H1 rules", () => {
  test("h1-missing is an error, and the rest is still parsed", () => {
    const r = lintLlmsTxt("> summary\n\n## Docs\n\n- [A](https://e.com/a)\n");
    assert.equal(only(r, "h1-missing").severity, "error");
    assert.equal(r.doc.title, null);
    assert.equal(r.doc.summary, "summary");
    assert.equal(r.doc.sections[0].links.length, 1);
  });

  test("h1-empty is an error", () => {
    for (const text of ["#\n", "# \n", "# ##\n"]) {
      const f = only(lintLlmsTxt(text), "h1-empty");
      assert.equal(f.severity, "error");
      assert.equal(f.line, 1);
    }
  });

  test("h1-not-first: content above the H1 is reported and ignored", () => {
    const r = lintLlmsTxt("Intro text\n\n# T\n\n> s\n");
    const f = only(r, "h1-not-first");
    assert.equal(f.severity, "warning");
    assert.equal(f.line, 1);
    assert.equal(r.doc.title, "T");
    assert.equal(r.doc.summary, "s");
    assert.equal(r.doc.details, null);
  });

  test("h1-multiple, in the details and in a section", () => {
    const r = lintLlmsTxt("# T\n\n# Again\n\n## Docs\n\n# Third\n- [A](https://e.com/a)\n");
    assert.deepEqual(r.findings.filter((f) => f.rule === "h1-multiple").map((f) => f.line), [3, 7]);
    assert.equal(r.doc.title, "T");
  });
});

describe("heading rules", () => {
  test("heading-level in the details", () => {
    const r = lintLlmsTxt("# T\n\n### Notes\n\nText\n");
    const f = only(r, "heading-level");
    assert.equal(f.line, 3);
    assert.match(f.message, /details/);
  });

  test("heading-level inside a section, for H3 through H6", () => {
    const r = lintLlmsTxt("# T\n\n## Docs\n\n### Sub\n#### Deeper\n###### Deepest\n- [A](https://e.com/a)\n");
    assert.deepEqual(r.findings.map((f) => [f.rule, f.line]), [["heading-level", 5], ["heading-level", 6], ["heading-level", 7]]);
    assert.match(r.findings[0].message, /section "Docs"/);
    assert.equal(r.doc.sections[0].links.length, 1);
  });

  test("heading-space: #Title is not a heading", () => {
    const r = lintLlmsTxt("#Title\n");
    assert.deepEqual(rules(r), ["h1-missing", "heading-space"]);
    assert.match(only(r, "heading-space").message, /"# Title"/);
  });

  test("heading-space in a section is reported instead of section-content", () => {
    const r = lintLlmsTxt("# T\n\n## Docs\n\n##More\n- [A](https://e.com/a)\n");
    assert.equal(only(r, "heading-space").line, 5);
    assert.equal(r.doc.sections.length, 1);
  });

  test("seven hashes are a paragraph, not a heading", () => {
    assert.deepEqual(rules(lintLlmsTxt("# T\n\n####### seven\n")), []);
  });
});

describe("summary rule", () => {
  test("summary-misplaced: a blockquote after other details", () => {
    const r = lintLlmsTxt("# T\n\nIntro.\n\n> Looks like a summary\n> still it\n");
    assert.equal(only(r, "summary-misplaced").line, 5);
    assert.equal(r.doc.summary, null);
    assert.match(r.doc.details ?? "", /^Intro\.\n\n> Looks/);
  });

  test("a blockquote in the details after a real summary is fine", () => {
    assert.deepEqual(rules(lintLlmsTxt("# T\n\n> Summary\n\nDetails.\n\n> A quote\n")), []);
  });

  test("blank lines between the H1 and the summary are fine", () => {
    assert.equal(lintLlmsTxt("# T\n\n\n> Summary\n").doc.summary, "Summary");
  });
});

describe("section rules", () => {
  test("section-empty", () => {
    const r = lintLlmsTxt("# T\n\n## Empty\n\n## Docs\n\n- [A](https://e.com/a)\n");
    const f = only(r, "section-empty");
    assert.equal(f.line, 3);
    assert.match(f.message, /"Empty"/);
  });

  test("a section with content but no links is not also section-empty", () => {
    const r = lintLlmsTxt("# T\n\n## Notes\n\n- plain bullet\n\n## Prose\n\nJust text.\n\n## Sub\n\n### Heading\n");
    assert.deepEqual(rules(r), ["link-malformed", "section-content", "heading-level"]);
    assert.deepEqual(r.doc.sections.map((s) => s.links.length), [0, 0, 0]);
  });

  test("section-content is reported once per section", () => {
    const r = lintLlmsTxt("# T\n\n## Docs\n\nIntro paragraph.\nMore text.\n\n- [A](https://e.com/a)\n\n## Other\n\n> quote\n- [B](https://e.com/b)\n");
    assert.deepEqual(r.findings.map((f) => [f.rule, f.line]), [["section-content", 5], ["section-content", 12]]);
  });

  test("a code block in a section is section-content", () => {
    assert.deepEqual(rules(lintLlmsTxt("# T\n\n## Docs\n\n```\n- [A](https://e.com/a)\n```\n- [B](https://e.com/b)\n")), ["section-content"]);
  });

  test("section-duplicate, case-insensitive, including a second Optional", () => {
    const r = lintLlmsTxt("# T\n\n## Docs\n- [A](https://e.com/a)\n## docs\n- [B](https://e.com/b)\n## Optional\n- [C](https://e.com/c)\n## Optional\n- [D](https://e.com/d)\n");
    assert.deepEqual(r.findings.map((f) => [f.rule, f.line]), [["section-duplicate", 5], ["section-duplicate", 9]]);
    assert.deepEqual(r.doc.sections.map((s) => s.optional), [false, false, true, true]);
  });

  test("optional-misspelled catches case, typos and suffixes", () => {
    for (const title of ["optional", "OPTIONAL", "Optinal", "Opitonal", "Optionals", "Optional links", "Optional:"]) {
      const r = lintLlmsTxt(`# T\n\n## ${title}\n\n- [A](https://e.com/a)\n`);
      assert.equal(only(r, "optional-misspelled").line, 3, title);
      assert.equal(r.doc.sections[0].optional, false);
    }
  });

  test("optional-misspelled leaves real section names alone", () => {
    for (const title of ["Options", "Option", "Optimization", "National"]) {
      assert.deepEqual(rules(lintLlmsTxt(`# T\n\n## ${title}\n\n- [A](https://e.com/a)\n`)), [], title);
    }
  });
});

describe("link rules", () => {
  test("link-malformed: no link, a link that isn't first, an empty item", () => {
    const r = lintLlmsTxt("# T\n\n## Docs\n\n- https://e.com/a\n- See [B](https://e.com/b)\n- \n- [C](https://e.com/c)\n");
    assert.deepEqual(r.findings.map((f) => [f.rule, f.line]), [["link-malformed", 5], ["link-malformed", 6], ["link-malformed", 7]]);
    assert.deepEqual(r.doc.sections[0].links.map((l) => l.title), ["C"]);
  });

  test("messages shorten a long quoted line", () => {
    const f = only(lintLlmsTxt(`# T\n\n## Docs\n\n- ${"word ".repeat(40)}\n`), "link-malformed");
    assert.match(f.message, /^"- (word ){15}\.\.\." doesn't start/);
  });

  test("link-malformed: an empty link name", () => {
    const f = only(lintLlmsTxt("# T\n\n## Docs\n\n- [](https://e.com/a)\n"), "link-malformed");
    assert.match(f.message, /empty name/);
  });

  test("link-malformed: a space in the URL", () => {
    only(lintLlmsTxt("# T\n\n## Docs\n\n- [A](https://e.com/a b)\n"), "link-malformed");
  });

  test("link-notes: text after the link without a colon is dropped", () => {
    const r = lintLlmsTxt("# T\n\n## Docs\n\n- [A](https://e.com/a) - notes with a dash\n");
    assert.equal(only(r, "link-notes").line, 5);
    assert.deepEqual(r.doc.sections[0].links[0], { title: "A", url: "https://e.com/a", notes: null, line: 5 });
  });

  test("list items in the details are not checked as links", () => {
    assert.deepEqual(rules(lintLlmsTxt("# T\n\n- plain item\n- [x](not a url)\n")), []);
  });
});

describe("URL rules", () => {
  test("url-invalid: unparseable, empty and non-http URLs", () => {
    const r = lintLlmsTxt("# T\n\n## Docs\n\n- [A](http://)\n- [B]()\n- [C](mailto:a@e.com)\n- [D](javascript:void(0))\n- [E](ftp://e.com/f)\n");
    assert.deepEqual(r.findings.map((f) => [f.rule, f.line]), [5, 6, 7, 8, 9].map((line) => ["url-invalid", line]));
    assert.match(r.findings[1].message, /no URL/);
    assert.match(r.findings[2].message, /mailto link/);
    assert.equal(r.doc.sections[0].links.length, 5);
  });

  test("url-duplicate across sections", () => {
    const r = lintLlmsTxt("# T\n\n## A\n- [A](https://e.com/a)\n## B\n- [Again](https://e.com/a)\n");
    const f = only(r, "url-duplicate");
    assert.equal(f.line, 6);
    assert.match(f.message, /line 4/);
  });

  test("url-duplicate compares resolved URLs when the file's URL is known", () => {
    const text = "# T\n\n## A\n- [A](/docs/a.md)\n- [B](https://e.com/docs/a.md)\n- [C](a.md)\n";
    assert.deepEqual(rules(lintLlmsTxt(text)), []);
    const r = lintLlmsTxt(text, { url: "https://e.com/docs/llms.txt" });
    assert.deepEqual(r.findings.map((f) => [f.rule, f.line]), [["url-duplicate", 5], ["url-duplicate", 6]]);
  });

  test("without the file's URL, relative links are compared as written", () => {
    // "a.md" and "/a.md" are one page only when the file is at the root.
    const text = "# T\n\n## A\n- [A](/a.md)\n- [B](a.md)\n- [C](../a.md)\n- [D](a.md)\n";
    assert.deepEqual(lintLlmsTxt(text).findings.map((f) => [f.rule, f.line]), [["url-duplicate", 7]]);
    assert.deepEqual(rules(lintLlmsTxt(text, { url: "https://e.com/docs/sub/llms.txt" })), ["url-duplicate"]);
  });

  test("different fragments are different URLs", () => {
    assert.deepEqual(rules(lintLlmsTxt("# T\n\n## A\n- [A](https://e.com/a#one)\n- [B](https://e.com/a#two)\n")), []);
  });
});

describe("severities", () => {
  test("only unusable files are errors", () => {
    const r = lintLlmsTxt(example("llms-with-problems.txt"));
    assert.equal(r.errorCount, 0);
    assert.equal(r.valid, true);
    assert.deepEqual(rules(r), ["summary-misplaced", "heading-level", "link-notes", "link-malformed", "url-duplicate", "section-empty", "optional-misspelled", "url-invalid"]);
    assert.equal(r.warningCount, 8);
  });
});
