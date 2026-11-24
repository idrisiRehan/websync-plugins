// Walks the tokens once and collects the elements the rules need, each marked with whether
// the parser would place it in <head>. The placement follows the WHATWG tree builder's
// insertion modes (https://html.spec.whatwg.org/multipage/parsing.html#the-insertion-mode):
// the head opens implicitly at the first metadata element and closes implicitly at the first
// content that can't be in it (non-whitespace text or any other start tag). Google reads head
// metadata the same way: https://developers.google.com/search/docs/crawling-indexing/valid-page-metadata

import { tokenizeHtml } from "./html.ts";

export interface ScannedElement {
  tag: string;
  attrs: Record<string, string>;
  line: number;
  inHead: boolean;
}

export interface ScannedTitle extends ScannedElement {
  /** Raw text content; whitespace is not collapsed yet. */
  text: string;
}

export interface Heading {
  level: number;
  text: string;
  line: number;
}

export interface ScannedPage {
  /** The doctype, only when it comes before any element or text (a later one is ignored by browsers). */
  doctype: { value: string; line: number } | null;
  /** The first <html> start tag. */
  html: ScannedElement | null;
  titles: ScannedTitle[];
  metas: ScannedElement[];
  links: ScannedElement[];
  bases: ScannedElement[];
  headings: Heading[];
  /** What ended the head without </head> or <body>, when something did. */
  headClosedBy: { what: string; line: number } | null;
}

// Elements allowed in <head>; any other start tag there opens <body>.
const HEAD_TAGS = new Set(["title", "meta", "link", "base", "script", "style", "noscript", "template"]);
const BODY_END_TAGS = new Set(["body", "html", "br"]);
// The tokenizer emits the content of these as one text token, which isn't page text.
const RAW_TEXT_TAGS = new Set(["script", "style", "title", "textarea"]);
// Content that isn't HTML elements: <noscript> is raw text when scripting is on (as in
// browsers and Google's renderer), <template> content is inert, and <svg>/<math> are
// foreign content whose <title> is an SVG tooltip, not the page title.
const SKIPPED_TAGS = new Set(["noscript", "template", "svg", "math"]);
const FOREIGN_TAGS = new Set(["svg", "math"]);
const HEADING = /^h[1-6]$/;
const NON_SPACE = /[^\t\n\f\r ]/;
const SPACES = /[\t\n\f\r ]+/g;

/** Collapses ASCII whitespace runs and trims, as document.title does. */
export function collapseWhitespace(text: string): string {
  return text.replace(SPACES, " ").trim();
}

export function scanPage(html: string): ScannedPage {
  const page: ScannedPage = { doctype: null, html: null, titles: [], metas: [], links: [], bases: [], headings: [], headClosedBy: null };
  let mode: "initial" | "head" | "after-head" | "body" = "initial";
  let seenContent = false;
  let skip: { tag: string; depth: number } | null = null;
  let rawText: string | null = null;
  let title: ScannedTitle | null = null;
  let heading: { level: number; line: number; parts: string[] } | null = null;

  const openBody = (what: string, line: number): void => {
    // After an explicit </head> the head was already closed, so nothing closed it implicitly.
    if (mode !== "after-head") page.headClosedBy = { what, line };
    mode = "body";
  };
  const closeHeading = (): void => {
    if (heading) page.headings.push({ level: heading.level, text: collapseWhitespace(heading.parts.join("")), line: heading.line });
    heading = null;
  };

  for (const token of tokenizeHtml(html)) {
    if (skip) {
      if (token.type === "start" && token.tag === skip.tag) skip.depth++;
      else if (token.type === "end" && token.tag === skip.tag && --skip.depth === 0) skip = null;
      continue;
    }
    if (rawText) {
      if (token.type === "text" && title) title.text += token.text;
      else if (token.type === "end" && token.tag === rawText) rawText = title = null;
      continue;
    }

    if (token.type === "doctype") {
      if (!seenContent && !page.doctype) page.doctype = { value: token.value, line: token.line };
    } else if (token.type === "text") {
      if (heading) heading.parts.push(token.text);
      const firstChar = token.text.search(NON_SPACE);
      if (firstChar !== -1) {
        seenContent = true;
        if (mode !== "body") {
          const snippet = collapseWhitespace(token.text);
          // The token starts at its leading whitespace; report the line where the text is.
          const line = token.line + token.text.slice(0, firstChar).split("\n").length - 1;
          openBody(`text "${snippet.length > 30 ? `${snippet.slice(0, 30)}...` : snippet}"`, line);
        }
      }
    } else if (token.type === "end") {
      if (token.tag === "head" && mode === "head") mode = "after-head";
      // Before the body, these end tags end the head and open the body; other end tags are ignored.
      else if (BODY_END_TAGS.has(token.tag) && mode !== "body") openBody(`</${token.tag}>`, token.line);
      else if (HEADING.test(token.tag)) closeHeading();
    } else {
      seenContent = true;
      const { tag, attrs, line } = token;
      if (tag === "html") {
        page.html ??= { tag, attrs, line, inHead: false };
        continue;
      }
      if (tag === "head") {
        if (mode === "initial") mode = "head";
        continue;
      }
      if (tag === "body") {
        mode = "body";
        continue;
      }
      // After </head>, <noscript> is not one of the elements that go back into the head.
      if (HEAD_TAGS.has(tag) && !(tag === "noscript" && mode === "after-head")) {
        if (mode === "initial") mode = "head";
      } else if (mode !== "body") {
        openBody(`<${tag}>`, line);
      }

      const element: ScannedElement = { tag, attrs, line, inHead: mode !== "body" };
      if (tag === "meta") page.metas.push(element);
      else if (tag === "link") page.links.push(element);
      else if (tag === "base") page.bases.push(element);
      else if (tag === "title") page.titles.push((title = { ...element, text: "" }));

      if (HEADING.test(tag)) {
        // A heading start tag closes an open heading, as the tree builder does.
        closeHeading();
        heading = { level: Number(tag[1]), line, parts: [] };
      } else if (tag === "img" && heading && attrs.alt) {
        heading.parts.push(attrs.alt);
      }

      if (RAW_TEXT_TAGS.has(tag)) rawText = tag;
      // "/>" is honoured only in foreign content; on <noscript> and <template> it is ignored.
      else if (SKIPPED_TAGS.has(tag) && !(token.selfClosing && FOREIGN_TAGS.has(tag))) skip = { tag, depth: 1 };
    }
  }
  closeHeading();
  return page;
}
