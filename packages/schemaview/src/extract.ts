// Finds the JSON-LD in the input: the whole input when it is JSON, otherwise the content of
// every <script type="application/ld+json"> in the HTML.

import { tokenizeHtml } from "metacheck";

export interface JsonLdBlock {
  text: string;
  /** Line in the input where `text` starts. */
  line: number;
  /** Line of the <script> tag, or 1 for raw JSON. */
  scriptLine: number;
}

export interface Extracted {
  format: "html" | "json";
  blocks: JsonLdBlock[];
  /** The HTML carries Microdata or RDFa attributes, which are not checked. */
  otherSyntax: boolean;
}

// The type attribute is matched case-insensitively and may carry parameters (";charset=utf-8").
const JSON_LD_TYPE = /^\s*application\/ld\+json\s*(?:;.*)?$/is;

export function extractJsonLd(input: string): Extracted {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const first = text.trimStart()[0];
  if (first === "{" || first === "[") return { format: "json", blocks: [{ text, line: 1, scriptLine: 1 }], otherSyntax: false };

  const tokens = tokenizeHtml(text);
  const blocks: JsonLdBlock[] = [];
  let otherSyntax = false;
  tokens.forEach((token, i) => {
    if (token.type !== "start") return;
    if ("itemscope" in token.attrs || "typeof" in token.attrs || "vocab" in token.attrs) otherSyntax = true;
    if (token.tag !== "script" || !JSON_LD_TYPE.test(token.attrs.type ?? "")) return;
    const next = tokens[i + 1];
    // An empty script produces no text token, so the next token is its end tag (or nothing).
    blocks.push(next?.type === "text" ? { text: next.text, line: next.line, scriptLine: token.line } : { text: "", line: token.line, scriptLine: token.line });
  });
  return { format: "html", blocks, otherSyntax };
}
