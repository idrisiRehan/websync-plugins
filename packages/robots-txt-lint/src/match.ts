// RFC 9309 matching (https://www.rfc-editor.org/rfc/rfc9309.html, checked 2026-11-24): group
// selection (s2.2.1), longest match with allow winning ties (s2.2.2), "*" and "$" (s2.2.3) and
// percent-encoding normalisation (s2.2.2). Works on parsed groups; parsing lives in lint.ts.

import type { RobotsGroup, RobotsRule } from "./lint.ts";

export interface AccessDecision {
  allowed: boolean;
  /** The rule that decided, or null when none matched (or the path is /robots.txt), which allows. */
  rule: RobotsRule | null;
  /** "specific" when a group names the user agent, "*" when the * group applied, null when no group did. */
  group: "specific" | "*" | null;
  /** 1-based line of each group that applied. Several groups for one agent are merged. */
  groupLines: number[];
  /** The path as compared, after normalisation. */
  path: string;
}

export interface GroupSelection {
  group: AccessDecision["group"];
  groups: RobotsGroup[];
}

/** RFC 9309 s2.2.1: a product token is letters, "-" and "_" only. */
export const PRODUCT_TOKEN = /^[A-Za-z_-]+$/;

/**
 * The product token a crawler reads from a user-agent value, as Google's parser does
 * (robots.cc, HandleUserAgent and ExtractUserAgent): "*" alone or followed by whitespace, else
 * the leading letters, "-" and "_", so "Googlebot/2.1" is "Googlebot". Empty when there is none.
 */
export function productToken(value: string): string {
  if (value[0] === "*" && (value.length === 1 || /\s/.test(value[1]))) return "*";
  return /^[A-Za-z_-]*/.exec(value)?.[0] ?? "";
}

const UNRESERVED = /^[A-Za-z0-9._~-]$/;

const isHex = (c: number) => (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);

/**
 * Brings a URL path or a rule pattern to the form RFC 9309 s2.2.2 compares: characters outside
 * ASCII are percent-encoded as UTF-8, escapes of unreserved characters are decoded ("%62" is "b"),
 * and other escapes get uppercase hex. Both sides get the same treatment so that equal paths
 * compare equal however they were written. In a path, a literal "*" or "$" becomes "%2A" or "%24",
 * so a rule can match them only in that encoded form (s2.2.3). In a pattern, "*" is a wildcard and
 * "$" ends the match only as the last character; elsewhere it is a literal "$".
 */
export function normalize(value: string, isPattern: boolean): string {
  let out = "";
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c === 0x25 && isHex(value.charCodeAt(i + 1)) && isHex(value.charCodeAt(i + 2))) {
      const hex = value.slice(i + 1, i + 3).toUpperCase();
      const char = String.fromCharCode(parseInt(hex, 16));
      out += UNRESERVED.test(char) ? char : `%${hex}`;
      i += 2;
    } else if (c > 0x7f) {
      const point = value.codePointAt(i) ?? 0xfffd;
      if (point > 0xffff) i++;
      // A lone surrogate can't be encoded as UTF-8; decoders turn it into U+FFFD, so do the same.
      out += encodeURIComponent(String.fromCodePoint(point >= 0xd800 && point <= 0xdfff ? 0xfffd : point));
    } else if (c === 0x2a && !isPattern) {
      out += "%2A";
    } else if (c === 0x24 && (!isPattern || i < value.length - 1)) {
      out += "%24";
    } else {
      out += value[i];
    }
  }
  return out;
}

/**
 * True when a normalised pattern matches a normalised path, from the path's first character.
 * Splits on "*" and finds each piece at its leftmost position, which is enough for a pattern
 * whose only wildcard is "*", and stays linear where a regex built from the pattern might not.
 */
export function patternMatches(path: string, pattern: string): boolean {
  const anchored = pattern.endsWith("$");
  // Most patterns are plain prefixes; skip the split for them.
  if (!pattern.includes("*")) return anchored ? path.length === pattern.length - 1 && pattern.startsWith(path) : path.startsWith(pattern);
  const pieces = (anchored ? pattern.slice(0, -1) : pattern).split("*");
  const first = pieces[0];
  if (!path.startsWith(first)) return false;
  if (pieces.length === 1) return !anchored || path.length === first.length;
  let pos = first.length;
  for (let i = 1; i < pieces.length - 1; i++) {
    const at = path.indexOf(pieces[i], pos);
    if (at === -1) return false;
    pos = at + pieces[i].length;
  }
  const last = pieces[pieces.length - 1];
  return anchored ? path.length - last.length >= pos && path.endsWith(last) : path.indexOf(last, pos) !== -1;
}

/** True for a normalised pattern that matches every path: "/", "/*", "*", "/*$" or "*$". */
export function matchesEverything(pattern: string): boolean {
  return /^(?:\/\**|\*+|\/?\*+\$)$/.test(pattern);
}

/**
 * RFC 9309 s2.2.1: every group naming the product token (case-insensitive) applies, merged;
 * without one, every "*" group does; without those, no rules apply.
 */
export function selectGroups(groups: readonly RobotsGroup[], userAgent: string): GroupSelection {
  const token = userAgent.toLowerCase();
  const named = groups.filter((g) => g.agents.some((a) => productToken(a).toLowerCase() === token));
  if (named.length) return { group: token === "*" ? "*" : "specific", groups: named };
  const global = token === "*" ? [] : groups.filter((g) => g.agents.some((a) => productToken(a) === "*"));
  return { group: global.length ? "*" : null, groups: global };
}

// Each rule's normalised pattern, so deciding many paths against one file normalises each rule
// once. Keyed by the pattern as written too, in case a caller edits a rule.
const normalizedPatterns = new WeakMap<RobotsRule, { raw: string; normalized: string }>();

function patternOf(rule: RobotsRule): string {
  let cached = normalizedPatterns.get(rule);
  if (cached?.raw !== rule.pattern) {
    cached = { raw: rule.pattern, normalized: normalize(rule.pattern, true) };
    normalizedPatterns.set(rule, cached);
  }
  return cached.normalized;
}

/** Decides whether `userAgent` may fetch `path`, which must already be normalised. */
export function decide(groups: readonly RobotsGroup[], userAgent: string, path: string): AccessDecision {
  const selection = selectGroups(groups, userAgent);
  const result = { group: selection.group, groupLines: selection.groups.map((g) => g.line), path };
  // s2.2.2: "The /robots.txt URI is implicitly allowed."
  if (path === "/robots.txt") return { allowed: true, rule: null, ...result };
  let best: RobotsRule | null = null;
  let bestLength = -1;
  for (const g of selection.groups) {
    for (const rule of g.rules) {
      // An empty pattern matches nothing; Google: "Crawlers ignore rules without a [path]".
      if (!rule.pattern) continue;
      const pattern = patternOf(rule);
      if (pattern.length < bestLength || !patternMatches(path, pattern)) continue;
      // The longest pattern wins; on a tie, allow wins (s2.2.2).
      if (pattern.length > bestLength || (rule.type === "allow" && best?.type === "disallow")) {
        best = rule;
        bestLength = pattern.length;
      }
    }
  }
  return { allowed: best?.type !== "disallow", rule: best, ...result };
}
