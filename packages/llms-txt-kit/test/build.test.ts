import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildLlmsTxt } from "../src/build.ts";
import { lintLlmsTxt, type LlmsTxtDoc } from "../src/lint.ts";

const example = (name: string) => readFileSync(new URL(`../examples/${name}`, import.meta.url), "utf8");

describe("buildLlmsTxt", () => {
  test("renders canonical markdown", () => {
    const md = buildLlmsTxt({
      title: "Site",
      summary: "One line.",
      details: "Some details.",
      sections: [
        { title: "Docs", links: [{ title: "A", url: "https://e.com/a.md", notes: "about A" }, { title: "B", url: "/b.md" }] },
        { title: "Optional", links: [{ title: "C", url: "https://e.com/c.md", notes: null }] },
      ],
    });
    assert.equal(md, "# Site\n\n> One line.\n\nSome details.\n\n## Docs\n\n- [A](https://e.com/a.md): about A\n- [B](/b.md)\n\n## Optional\n\n- [C](https://e.com/c.md)\n");
  });

  test("a title alone", () => {
    assert.equal(buildLlmsTxt({ title: "Site", sections: [] }), "# Site\n");
  });

  test("a multi-line summary is quoted line by line", () => {
    assert.equal(buildLlmsTxt({ title: "S", summary: "one\ntwo\n\nthree", sections: [] }), "# S\n\n> one\n> two\n>\n> three\n");
  });

  test("an empty section is written as a bare H2", () => {
    assert.equal(buildLlmsTxt({ title: "S", sections: [{ title: "Later", links: [] }] }), "# S\n\n## Later\n");
  });

  test("trims single-line fields and blank edges of details; empty strings count as absent", () => {
    const md = buildLlmsTxt({ title: "  S  ", summary: "", details: "\n\n  text\n\n", sections: [{ title: " Docs ", links: [{ title: " A ", url: " https://e.com/ ", notes: "  " }] }] });
    assert.equal(md, "# S\n\n  text\n\n## Docs\n\n- [A](https://e.com/)\n");
  });

  test("normalizes CRLF in details", () => {
    assert.equal(buildLlmsTxt({ title: "S", details: "a\r\nb", sections: [] }), "# S\n\na\nb\n");
  });
});

describe("round trip", () => {
  test("build(lint(x).doc) reproduces the example file exactly", () => {
    const text = example("llms.txt");
    assert.equal(buildLlmsTxt(lintLlmsTxt(text).doc), text);
  });

  test("the example spec builds the example file", () => {
    assert.equal(buildLlmsTxt(JSON.parse(example("llms-spec.json")) as LlmsTxtDoc), example("llms.txt"));
  });

  test("lint(build(doc)).doc gives back the document", () => {
    const doc: LlmsTxtDoc = {
      title: "Site",
      summary: "Summary\nover two lines",
      details: "Details with a list:\n\n- one\n- two\n\n```\n# code\n```",
      sections: [{ title: "Docs", optional: false, line: 15, links: [{ title: "W", url: "https://en.wikipedia.org/wiki/A_(b)", notes: "n: with a colon", line: 17 }] }],
    };
    assert.deepEqual(lintLlmsTxt(buildLlmsTxt(doc)).doc, doc);
  });

  test("a non-canonical file builds to its canonical form", () => {
    const messy = "#   Site  \n> Sum\n\n\n## Docs\n* [A](https://e.com/a)  :  notes\n";
    assert.equal(buildLlmsTxt(lintLlmsTxt(messy).doc), "# Site\n\n> Sum\n\n## Docs\n\n- [A](https://e.com/a): notes\n");
  });

  test("generated documents: build either refuses or round-trips exactly", () => {
    // A seeded generator over the characters markdown cares about, so failures reproduce.
    let seed = 1;
    const random = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const pick = <T>(items: T[]): T => items[Math.floor(random() * items.length)];
    const atoms = ["a", "Z", " ", "\t", "[", "]", "(", ")", "#", "# ", "> ", "- ", "* ", "1. ", ":", "`", "```", "~~~", "\\", "<", "\n", "\n\n", "===", String.fromCharCode(0x2028), "https://e.com/x"];
    const text = (max: number) => Array.from({ length: Math.floor(random() * max) }, () => pick(atoms)).join("");
    const line = (prefix: string, max: number) => prefix + text(max).replace(/\n/g, "");
    let built = 0;
    for (let k = 0; k < 2000; k++) {
      const doc: LlmsTxtDoc = {
        title: line("T", 4),
        summary: random() < 0.5 ? text(6) : null,
        details: random() < 0.5 ? text(10) : null,
        sections: Array.from({ length: Math.floor(random() * 3) }, () => ({
          title: line("S", 3),
          links: Array.from({ length: Math.floor(random() * 3) }, () => ({ title: line("L", 3), url: line(pick(["https://e.com/", "/", "a"]), 3), notes: random() < 0.5 ? line("", 4) : null })),
        })),
      };
      let markdown: string;
      try {
        markdown = buildLlmsTxt(doc);
      } catch (error) {
        assert.ok(error instanceof TypeError, String(error));
        continue;
      }
      built++;
      assert.equal(buildLlmsTxt(lintLlmsTxt(markdown).doc), markdown, JSON.stringify(doc));
    }
    assert.ok(built > 1000, `only ${built} of 2000 documents built`);
  });
});

describe("invalid input", () => {
  const bad = (doc: unknown, message: RegExp) => assert.throws(() => buildLlmsTxt(doc as LlmsTxtDoc), { name: "TypeError", message });

  test("wrong shapes name the field", () => {
    bad(null, /The document must be an object/);
    bad([], /The document must be an object/);
    bad({ sections: [] }, /^title is required/);
    bad({ title: null, sections: [] }, /^title is required/);
    bad({ title: " ", sections: [] }, /^title must not be empty/);
    bad({ title: 5 }, /^title must be a string/);
    bad({ title: "S", summary: 1 }, /^summary must be a string/);
    bad({ title: "S", sections: {} }, /^sections must be an array/);
    bad({ title: "S", sections: ["x"] }, /^sections\[0\] must be an object/);
    bad({ title: "S", sections: [{ links: [] }] }, /^sections\[0\]\.title is required/);
    bad({ title: "S", sections: [{ title: "D", links: [{ title: "A" }] }] }, /^sections\[0\]\.links\[0\]\.url is required/);
    bad({ title: "S", sections: [{ title: "D", links: [{ title: "A", url: "u", notes: 3 }] }] }, /^sections\[0\]\.links\[0\]\.notes must be a string/);
  });

  test("line breaks in single-line fields are refused", () => {
    bad({ title: "Two\nlines" }, /^title must be a single line/);
    bad({ title: "S", sections: [{ title: "D", links: [{ title: "A", url: "u", notes: "a\nb" }] }] }, /notes must be a single line/);
  });

  test("values markdown can't carry are refused instead of silently changed", () => {
    bad({ title: "S", sections: [{ title: "D", links: [{ title: "A ] B", url: "https://e.com/" }] }] }, /^sections\[0\]\.links\[0\] can't be written/);
    bad({ title: "S", sections: [{ title: "D", links: [{ title: "A", url: "https://e.com/a b" }] }] }, /^sections\[0\]\.links\[0\] can't be written/);
    bad({ title: "S", details: "Intro\n\n## Sneaky section", sections: [] }, /^details can't be written/);
    bad({ title: "S", details: "> looks like a summary", sections: [] }, /^summary can't be written/);
  });
});
