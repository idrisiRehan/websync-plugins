// Walks the tokens once and collects the elements the rules need, each marked with whether
// the parser would place it in <head>. The placement follows the WHATWG tree builder's
// insertion modes (https://html.spec.whatwg.org/multipage/parsing.html#the-insertion-mode):
// the head opens implicitly at the first metadata element and closes implicitly at the first
// content that can't be in it (non-whitespace text or any other start tag). Google reads head
// metadata the same way: https://developers.google.com/search/docs/crawling-indexing/valid-page-metadata

import { tokenizeHtml, type HtmlToken } from "./html.ts";

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
// HTML start tags that end foreign content, so an unclosed <svg> can't hide the rest of the
// page (WHATWG "rules for parsing tokens in foreign content"). <font> breaks out only with
// color, face or size.
const BREAKOUT_TAGS = new Set([
  "b", "big", "blockquote", "body", "br", "center", "code", "dd", "div", "dl", "dt", "em", "embed", "h1", "h2", "h3",
  "h4", "h5", "h6", "head", "hr", "i", "img", "li", "listing", "menu", "meta", "nobr", "ol", "p", "pre", "ruby", "s",
  "small", "span", "strong", "strike", "sub", "sup", "table", "tt", "u", "ul", "var",
]);
// Elements inside foreign content whose children are parsed as HTML, so a <div> in them stays
// there: SVG's HTML integration points and MathML's text integration points.
const INTEGRATION_POINTS = new Set(["foreignobject", "desc", "title", "annotation-xml", "mi", "mo", "mn", "ms", "mtext"]);

/** True when a token ends the foreign content it appears in, as the tree builder does. */
function breaksOut(token: HtmlToken): boolean {
  if (token.type === "end") return token.tag === "br" || token.tag === "p";
  if (token.type !== "start") return false;
  if (token.tag === "font") return "color" in token.attrs || "face" in token.attrs || "size" in token.attrs;
  return BREAKOUT_TAGS.has(token.tag);
}
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
  // `html` counts open integration points inside foreign content.
  let skip: { tag: string; depth: number; html: number } | null = null;
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
      const foreign = FOREIGN_TAGS.has(skip.tag);
      if (foreign && skip.html === 0 && breaksOut(token)) {
        skip = null; // and the token is read below as ordinary HTML
      } else {
        if (token.type === "start" && token.tag === skip.tag) skip.depth++;
        else if (token.type === "end" && token.tag === skip.tag && --skip.depth === 0) skip = null;
        else if (foreign && token.type !== "text" && token.type !== "doctype" && INTEGRATION_POINTS.has(token.tag)) {
          if (token.type === "start" && !token.selfClosing) skip.html++;
          else if (token.type === "end" && skip.html > 0) skip.html--;
        }
        continue;
      }
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
      else if (SKIPPED_TAGS.has(tag) && !(token.selfClosing && FOREIGN_TAGS.has(tag))) skip = { tag, depth: 1, html: 0 };
    }
  }
  closeHeading();
  return page;
}
