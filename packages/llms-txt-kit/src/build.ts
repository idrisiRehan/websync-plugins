// Renders an LlmsTxtDoc as canonical llms.txt markdown, the inverse of the parse in lint.ts.

import { lintLlmsTxt, type LlmsTxtDoc } from "./lint.ts";

interface Normalized {
  title: string;
  summary: string | null;
  details: string | null;
  sections: { title: string; links: { title: string; url: string; notes: string | null }[] }[];
}

function fail(path: string, problem: string): never {
  throw new TypeError(`${path} ${problem}.`);
}

function singleLine(value: unknown, path: string, required: boolean): string | null {
  if (value === undefined || value === null) {
    if (required) fail(path, "is required");
    return null;
  }
  if (typeof value !== "string") fail(path, "must be a string");
  const text = value.trim();
  if (/[\r\n]/.test(text)) fail(path, "must be a single line");
  if (!text && required) fail(path, "must not be empty");
  return text || null;
}

function multiLine(value: unknown, path: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") fail(path, "must be a string");
  return value.replace(/\r\n?/g, "\n").replace(/^(?:[ \t]*\n)+/, "").trimEnd() || null;
}

function list(value: unknown, path: string): unknown[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) fail(path, "must be an array");
  return value;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail(path, "must be an object");
  return value as Record<string, unknown>;
}

function normalize(input: unknown): Normalized {
  const doc = record(input, "The document");
  return {
    title: singleLine(doc.title, "title", true) as string,
    summary: multiLine(doc.summary, "summary")?.trim() || null,
    details: multiLine(doc.details, "details"),
    sections: list(doc.sections, "sections").map((s, i) => {
      const section = record(s, `sections[${i}]`);
      return {
        title: singleLine(section.title, `sections[${i}].title`, true) as string,
        links: list(section.links, `sections[${i}].links`).map((l, j) => {
          const path = `sections[${i}].links[${j}]`;
          const link = record(l, path);
          return {
            title: singleLine(link.title, `${path}.title`, true) as string,
            url: singleLine(link.url, `${path}.url`, true) as string,
            notes: singleLine(link.notes, `${path}.notes`, false),
          };
        }),
      };
    }),
  };
}

/** The first field where `actual` differs from `expected`, or null when they match. */
function firstDifference(expected: Normalized, actual: LlmsTxtDoc): string | null {
  for (const key of ["title", "summary", "details"] as const) {
    if ((actual[key] ?? null) !== expected[key]) return key;
  }
  for (const [i, s] of expected.sections.entries()) {
    const back = actual.sections[i];
    if (back?.title !== s.title) return `sections[${i}].title`;
    for (const [j, l] of s.links.entries()) {
      const link = back.links[j];
      if (link?.title !== l.title || link.url !== l.url || (link.notes ?? null) !== l.notes) return `sections[${i}].links[${j}]`;
    }
    if (back.links.length !== s.links.length) return `sections[${i}].links`;
  }
  return actual.sections.length !== expected.sections.length ? "details" : null;
}

/**
 * Renders a document as llms.txt markdown. Throws a TypeError when the input has the wrong
 * shape, or when a value can't be written without changing its meaning (a "]" in a link title,
 * a URL with spaces, a heading inside details).
 */
export function buildLlmsTxt(doc: LlmsTxtDoc): string {
  const n = normalize(doc);
  const blocks = [`# ${n.title}`];
  if (n.summary) blocks.push(n.summary.split("\n").map((line) => (line ? `> ${line}` : ">")).join("\n"));
  if (n.details) blocks.push(n.details);
  for (const section of n.sections) {
    blocks.push(`## ${section.title}`);
    if (section.links.length) {
      blocks.push(section.links.map((l) => `- [${l.title}](${l.url})${l.notes ? `: ${l.notes}` : ""}`).join("\n"));
    }
  }
  const markdown = `${blocks.join("\n\n")}\n`;

  // Parsing the output back is the one check that catches every value markdown can't carry.
  const changed = firstDifference(n, lintLlmsTxt(markdown).doc);
  if (changed) fail(changed, "can't be written as llms.txt markdown without changing its meaning (check for brackets, parentheses or spaces in links, and headings or a leading blockquote in details)");
  return markdown;
}
