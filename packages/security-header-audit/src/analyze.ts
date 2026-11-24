// Rule-based grading of HTTP response headers against security-header best practices. Pure
// and offline: it reads headers the caller already has and never makes a network request, so
// the same code runs in browsers, Node, edge runtimes and test suites. Each rule cites the
// specification it follows.

import { normalizeHeaders, type HeaderInput, type NormalizedHeaders } from "./headers.ts";

export type Severity = "passed" | "warning" | "failed";

export interface HeaderRule {
  id: string;
  name: string;
  category: "Transport" | "Content Security" | "Clickjacking" | "Privacy" | "Disclosure";
  status: Severity;
  message: string;
  scoreImpact: number;
}

/** "strong" at 80 or more, "needs-work" from 50 to 79, "weak" below 50. */
export type Rating = "strong" | "needs-work" | "weak";

export interface HeaderAuditResult {
  /** 0 to 100: 100 minus the sum of every rule's scoreImpact. */
  score: number;
  rating: Rating;
  rules: HeaderRule[];
}

export function ratingFor(score: number): Rating {
  return score >= 80 ? "strong" : score >= 50 ? "needs-work" : "weak";
}

function get(headers: NormalizedHeaders, name: string): string {
  return headers[name] ?? "";
}

// normalizeHeaders() lower-cases names and joins a repeated header's values with ", ", so "a, b"
// here can mean one field listing two values or the same header sent twice (RFC 9110 s5.3 treats
// those as equivalent). Each rule below decides what that means for its own header.

// Splits on `delim` outside double-quoted strings (RFC 9110 s5.6.4 quoted-string, backslash
// escapes included).
function splitOutsideQuotes(value: string, delim: string): string[] {
  const parts: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (inQuotes && ch === "\\" && i + 1 < value.length) {
      current += ch + value[++i];
      continue;
    }
    if (ch === '"') inQuotes = !inQuotes;
    if (ch === delim && !inQuotes) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

function unquote(value: string): string {
  const v = value.trim();
  if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) return v.slice(1, -1).replace(/\\(.)/g, "$1");
  return v;
}

// RFC 6797 s8.1: a UA that receives more than one Strict-Transport-Security field processes only
// the first. Within it (s6.1), directives are ";"-separated, directive names are
// case-insensitive, and a directive value may be a token or a quoted-string, so
// max-age="31536000" means the same as max-age=31536000 (s6.1.1). A missing or non-numeric
// max-age is reported as 0. Only the first max-age directive is read.
function parseHstsMaxAge(header: string): number {
  const firstField = splitOutsideQuotes(header, ",")[0] ?? "";
  for (const directive of splitOutsideQuotes(firstField, ";")) {
    const eq = directive.indexOf("=");
    const name = (eq === -1 ? directive : directive.slice(0, eq)).trim().toLowerCase();
    if (name !== "max-age") continue;
    const value = eq === -1 ? "" : unquote(directive.slice(eq + 1));
    return /^\d+$/.test(value) ? parseInt(value, 10) : 0;
  }
  return 0;
}

type CspPolicy = Map<string, string[]>;

// CSP Level 3 (W3C) s2.2 / s3.1: the header value is a comma-separated list of serialized
// policies (a comma can't occur inside one), and every policy in it is enforced - which is also
// what a CSP header sent twice looks like once normalizeHeaders() joins it. s2.2.1 "Parse a serialized
// CSP": directives are ";"-separated, names are ASCII-lowercased, and a repeated directive is
// ignored (the first wins). Source expressions are whitespace-separated and their keywords
// match case-insensitively (s2.3.1).
function parseCsp(header: string): CspPolicy[] {
  return header
    .split(",")
    .map((serialized) => {
      const policy: CspPolicy = new Map();
      for (const token of serialized.split(";")) {
        const [name, ...sources] = token.trim().split(/\s+/);
        if (!name) continue;
        const key = name.toLowerCase();
        if (!policy.has(key)) policy.set(key, sources.map((s) => s.toLowerCase()));
      }
      return policy;
    })
    .filter((policy) => policy.size > 0);
}

// CSP3 s6.8.3 "Get fetch directive fallback list": the first directive present governs. null
// means no directive governs it, i.e. that policy doesn't restrict it at all.
function governingSources(policy: CspPolicy, fallback: string[]): string[] | null {
  for (const name of fallback) {
    const list = policy.get(name);
    if (list) return list;
  }
  return null;
}

const isNonceOrHash = (source: string) => /^'(nonce|sha256|sha384|sha512)-/.test(source);

// CSP3 s6.7.3.2 "Does a source list allow all inline behavior for type?": 'unsafe-inline' only
// takes effect when the same source list has no nonce-source or hash-source and - for scripts
// and script attributes - no 'strict-dynamic'. CSP Level 2+ browsers ignore it otherwise; it
// stays in such policies only as a fallback for CSP1 browsers (s8.2).
function allowsAllInline(sources: string[], isScript: boolean): boolean {
  if (sources.some(isNonceOrHash)) return false;
  if (isScript && sources.includes("'strict-dynamic'")) return false;
  return sources.includes("'unsafe-inline'");
}

// Source expressions that match any host, per CSP3 s6.7.2.8 "Does url match expression in origin
// with redirect count?": "*" matches every URL whose scheme is an HTTP(S) scheme; a scheme-source
// (https:, or http:, which also matches https: per s6.7.2.9) matches every URL with that scheme;
// and a host-source whose host-part is "*" matches any host (s6.7.2.10), whatever its port or path.
const ANY_HOST = /^(?:https?:|(?:https?:\/\/)?\*(?:[:/].*)?)$/;
const anyHostSources = (sources: string[]) => sources.filter((s) => ANY_HOST.test(s));
// A product version in a Server value: "nginx/1.18.0", "Apache/2.4.41 (Ubuntu)", "Microsoft-IIS/10.0".
const SERVER_VERSION = /\/\s*v?\d+(?:\.\d+)*\b|\b\d+\.\d+/;

const SCRIPT_ELEM_FALLBACK = ["script-src-elem", "script-src", "default-src"];

// One check per weakness, with the fallback chain that governs it. Returns true/false for
// whether that policy allows it, or null if it's ungoverned.
const CSP_CHECKS: { id: "script sources" | "eval" | "scripts" | "event handlers" | "styles"; allows: (p: CspPolicy) => boolean | null }[] = [
  {
    // CSP3 s6.1.10 script-src: inline script is blocked unless every policy allows it, "either
    // implicitly by not specifying a script-src (or default-src) directive, or explicitly", and
    // script requests are matched against the same fallback list (s6.8.3). So a policy with no
    // governing directive, or one that matches any host, doesn't restrict scripts and is no
    // protection against XSS; this is flagged only when no policy restricts them.
    // 'strict-dynamic' makes CSP3 browsers ignore host-source and scheme-source expressions
    // when loading script (s8.2), so `https:` beside it is only a fallback for older browsers.
    id: "script sources",
    allows: (p) => {
      const list = governingSources(p, SCRIPT_ELEM_FALLBACK);
      return !list || (anyHostSources(list).length > 0 && !list.includes("'strict-dynamic'"));
    },
  },
  {
    // CSP3 s4.4.1 EnsureCSPDoesNotBlockStringCompilation: eval() is governed by script-src, then
    // default-src, and needs the exact keyword 'unsafe-eval'. 'wasm-unsafe-eval' (s2.3.1, s4.5.1
    // EnsureCSPDoesNotBlockWasmByteCompilation) is a separate keyword that permits WebAssembly
    // compilation only - it does not allow eval(), so exact-token matching leaves it out.
    id: "eval",
    allows: (p) => {
      const list = governingSources(p, ["script-src", "default-src"]);
      return list && list.includes("'unsafe-eval'");
    },
  },
  {
    id: "scripts",
    allows: (p) => {
      const list = governingSources(p, SCRIPT_ELEM_FALLBACK);
      return list && allowsAllInline(list, true);
    },
  },
  {
    id: "event handlers",
    allows: (p) => {
      const list = governingSources(p, ["script-src-attr", "script-src", "default-src"]);
      return list && allowsAllInline(list, true);
    },
  },
  {
    id: "styles",
    allows: (p) => {
      const elem = governingSources(p, ["style-src-elem", "style-src", "default-src"]);
      const attr = governingSources(p, ["style-src-attr", "style-src", "default-src"]);
      if (!elem && !attr) return null;
      return Boolean((elem && allowsAllInline(elem, false)) || (attr && allowsAllInline(attr, false)));
    },
  },
];

// Every policy is enforced (CSP3 s3.1), so something is only allowed if no policy forbids it -
// and it's only flagged when at least one policy grants it (for the keywords, a policy with no
// governing directive isn't penalised; for script sources, see that check).
function weakCspChecks(policies: CspPolicy[]): Set<string> {
  const weak = new Set<string>();
  for (const check of CSP_CHECKS) {
    const results = policies.map((p) => check.allows(p));
    if (results.some((r) => r === true) && results.every((r) => r !== false)) weak.add(check.id);
  }
  return weak;
}

// HTML Standard s7.7, "check a navigation response's adherence to X-Frame-Options" (used only
// when no frame-ancestors is present): the comma-split values are lowercased into a *set*, so
// "DENY, DENY" is just "deny".
// - More than one distinct value, any of them deny/sameorigin/allowall -> framing is blocked
//   outright (step 6), i.e. it behaves like DENY.
// - More than one distinct value, none recognised -> treated as if the header were absent (step 7).
// - One value: "deny" blocks, "sameorigin" allows same-origin framing only (steps 8-9); anything
//   else - "allowall", the obsolete ALLOW-FROM (which the spec says "is not to be implemented"),
//   or junk - is treated as if the header were absent.
// `reason` explains a non-protective or non-obvious result; empty for a plain DENY/SAMEORIGIN.
function evaluateXfo(raw: string): { protects: boolean; reason: string } {
  if (!raw) return { protects: false, reason: "" };
  const values = new Set(raw.split(",").map((v) => v.trim().toLowerCase()));
  if (values.size > 1) {
    if (["deny", "sameorigin", "allowall"].some((v) => values.has(v))) {
      return { protects: true, reason: "conflicting values, which browsers treat as DENY (framing blocked everywhere, including on your own site)" };
    }
    return { protects: false, reason: "none of its values is valid (only DENY or SAMEORIGIN are), so browsers ignore it" };
  }
  const [value] = values;
  if (value === "deny" || value === "sameorigin") return { protects: true, reason: "" };
  if (value === "allowall") return { protects: false, reason: "ALLOWALL isn't a protective value - browsers treat it as if the header were absent" };
  if (value.startsWith("allow-from")) return { protects: false, reason: "ALLOW-FROM is obsolete and ignored by current browsers" };
  return { protects: false, reason: "that isn't a valid value (only DENY or SAMEORIGIN are), so browsers ignore it" };
}

function joinList(items: string[]): string {
  return items.length <= 1 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** Grades a response's security headers. Header names are matched case-insensitively. */
export function analyzeHeaders(input: HeaderInput): HeaderAuditResult {
  const headers = normalizeHeaders(input);
  const rules: HeaderRule[] = [];
  let score = 100;
  const deduct = (n: number) => {
    score -= n;
  };

  // 1. Strict-Transport-Security (HSTS)
  const hsts = get(headers, "strict-transport-security");
  if (!hsts) {
    rules.push({
      id: "hsts-missing",
      name: "Strict-Transport-Security",
      category: "Transport",
      status: "failed",
      message: "Missing. Without HSTS, a visitor's first request (or one after a cleared cache) can still be intercepted over plain HTTP before any redirect to HTTPS happens.",
      scoreImpact: 15,
    });
    deduct(15);
  } else {
    // RFC 6797 s6.1 / s6.1.1 / s8.1 - see parseHstsMaxAge().
    const maxAge = parseHstsMaxAge(hsts);
    if (maxAge < 15_768_000) {
      rules.push({
        id: "hsts-short",
        name: "Strict-Transport-Security",
        category: "Transport",
        status: "warning",
        message: `Present, but max-age is only ${maxAge.toLocaleString("en-US")}s - recommend at least 15768000 (6 months) so the policy actually sticks between visits.`,
        scoreImpact: 5,
      });
      deduct(5);
    } else {
      rules.push({
        id: "hsts-ok",
        name: "Strict-Transport-Security",
        category: "Transport",
        status: "passed",
        message: `Present with a ${Math.round(maxAge / 86400)}-day max-age.`,
        scoreImpact: 0,
      });
    }
  }

  // 2. Content-Security-Policy
  const csp = get(headers, "content-security-policy");
  if (!csp) {
    rules.push({
      id: "csp-missing",
      name: "Content-Security-Policy",
      category: "Content Security",
      status: "failed",
      message: "Missing. CSP is the strongest available mitigation against XSS and data-injection attacks - without it, the browser enforces no restriction on what scripts/styles/frames a compromised or injected element can load.",
      scoreImpact: 15,
    });
    deduct(15);
  }
  // CSP3: parsed per s2.2.1 and judged per s4.4.1 (eval), s6.7.3.2 (inline) and s6.8.3
  // (fallbacks) - see parseCsp(), CSP_CHECKS and weakCspChecks() above.
  const cspPolicies = parseCsp(csp);
  if (csp) {
    const weak = weakCspChecks(cspPolicies);
    const allSources = cspPolicies.flatMap((p) => [...p.values()].flat());
    const notes: string[] = [];
    if (allSources.includes("'wasm-unsafe-eval'")) {
      notes.push("'wasm-unsafe-eval' isn't penalised: it permits WebAssembly compilation only, not JavaScript eval().");
    }
    const neutralisedInline = cspPolicies.some((p) =>
      [...p.entries()].some(
        ([name, list]) => list.includes("'unsafe-inline'") && !allowsAllInline(list, name.startsWith("script-src") || name === "default-src"),
      ),
    );
    if (neutralisedInline) {
      notes.push("'unsafe-inline' next to a nonce, hash or 'strict-dynamic' is ignored by CSP Level 2+ browsers (it's only a fallback for older ones), so it isn't penalised there.");
    }
    const noteText = notes.length ? ` ${notes.join(" ")}` : "";

    if (weak.size > 0) {
      const inlineKinds = (["scripts", "event handlers", "styles"] as const).filter((k) => weak.has(k));
      const openSources = [...new Set(cspPolicies.flatMap((p) => anyHostSources(governingSources(p, SCRIPT_ELEM_FALLBACK) ?? [])))];
      const found = [
        ...(weak.has("script sources")
          ? [`scripts from any site (${openSources.length ? `its script sources include ${joinList(openSources)}` : "it has no script-src or default-src directive"})`]
          : []),
        ...(inlineKinds.length ? [`'unsafe-inline' for ${joinList([...inlineKinds])}`] : []),
        ...(weak.has("eval") ? ["'unsafe-eval'"] : []),
      ];
      const xss = weak.has("script sources")
        ? " It only protects against XSS when script-src (or default-src) limits scripts to specific sources, nonces or hashes."
        : "";
      rules.push({
        id: "csp-unsafe",
        name: "Content-Security-Policy",
        category: "Content Security",
        status: "warning",
        message: `Present, but allows ${joinList(found)} - these significantly weaken CSP's protection against injected code.${xss}${noteText}`,
        scoreImpact: 5,
      });
      deduct(5);
    } else {
      rules.push({
        id: "csp-ok",
        name: "Content-Security-Policy",
        category: "Content Security",
        status: "passed",
        message: `Present, restricts where scripts load from, and has no 'unsafe-inline'/'unsafe-eval' in effect.${noteText}`,
        scoreImpact: 0,
      });
    }
  }

  // 3. X-Content-Type-Options
  // Fetch Standard, "determine nosniff": the header is split on commas and only the first value
  // counts - so "nosniff, nosniff" (sent twice) is nosniff, and so is "nosniff, foo".
  const xcto = get(headers, "x-content-type-options");
  const xctoValues = xcto ? xcto.split(",").map((v) => v.trim()) : [];
  const xctoFirst = xctoValues[0] ?? "";
  if (xctoFirst.toLowerCase() !== "nosniff") {
    rules.push({
      id: "xcto-missing",
      name: "X-Content-Type-Options",
      category: "Content Security",
      status: "warning",
      message: !xcto
        ? "Missing. Without \"nosniff\", some browsers will try to guess a response's content type, which can turn an upload endpoint into an XSS vector."
        : xctoValues.length > 1
          ? `Set to "${xcto}" - browsers only read the first value ("${xctoFirst}"), which isn't "nosniff".`
          : `Set to "${xcto}" instead of "nosniff".`,
      scoreImpact: 5,
    });
    deduct(5);
  } else {
    const ignored = xctoValues.slice(1).filter((v) => v.toLowerCase() !== "nosniff");
    rules.push({
      id: "xcto-ok",
      name: "X-Content-Type-Options",
      category: "Content Security",
      status: "passed",
      message: ignored.length ? `Set to "nosniff". Later values (${ignored.map((v) => `"${v}"`).join(", ")}) are ignored by browsers.` : 'Set to "nosniff".',
      scoreImpact: 0,
    });
  }

  // 4. Clickjacking protection - X-Frame-Options or CSP frame-ancestors
  // HTML Standard s7.7 "The X-Frame-Options header" and CSP3 s6.4.2.2: an enforced CSP with a
  // frame-ancestors directive makes the browser ignore X-Frame-Options entirely, whatever its
  // value. CSP3 s6.4.2: every ancestor's origin must match the directive's list, so it restricts
  // framing unless the list matches any host ("*", https:, http: or *-host sources, see
  // ANY_HOST); only 'none', 'self' or specific sources protect. Every policy is enforced, so one
  // restricting frame-ancestors is enough. Otherwise see evaluateXfo() for how XFO is read.
  const xfo = get(headers, "x-frame-options");
  const frameAncestors = cspPolicies.map((p) => p.get("frame-ancestors")).filter((list) => list !== undefined);
  const hasFrameAncestors = frameAncestors.length > 0;
  const restrictsFraming = frameAncestors.some((list) => anyHostSources(list).length === 0);
  const xfoResult = evaluateXfo(xfo);
  if (hasFrameAncestors && !restrictsFraming) {
    const open = [...new Set(frameAncestors.flatMap(anyHostSources))];
    rules.push({
      id: "clickjack-invalid",
      name: "Clickjacking protection",
      category: "Clickjacking",
      status: "failed",
      message: `CSP frame-ancestors includes ${joinList(open)}, which lets any site embed this page in an invisible iframe for a clickjacking attack, and browsers ignore X-Frame-Options when frame-ancestors is present${xfo ? `, so X-Frame-Options "${xfo}" has no effect` : ""}. Use frame-ancestors 'none', 'self' or a list of specific origins.`,
      scoreImpact: 10,
    });
    deduct(10);
  } else if (hasFrameAncestors) {
    rules.push({
      id: "clickjack-ok",
      name: "Clickjacking protection",
      category: "Clickjacking",
      status: "passed",
      message:
        xfo && !xfoResult.protects
          ? `Covered by CSP's frame-ancestors directive. (X-Frame-Options "${xfo}" ${xfoResult.reason} - but browsers ignore X-Frame-Options when frame-ancestors is present anyway.)`
          : "Covered by CSP's frame-ancestors directive.",
      scoreImpact: 0,
    });
  } else if (!xfo) {
    rules.push({
      id: "clickjack-missing",
      name: "Clickjacking protection",
      category: "Clickjacking",
      status: "failed",
      message: "Neither X-Frame-Options nor a CSP frame-ancestors directive is set - this page can be embedded in an invisible iframe on another site for a clickjacking attack.",
      scoreImpact: 10,
    });
    deduct(10);
  } else if (!xfoResult.protects) {
    rules.push({
      id: "clickjack-invalid",
      name: "Clickjacking protection",
      category: "Clickjacking",
      status: "failed",
      message: `X-Frame-Options is "${xfo}", but ${xfoResult.reason}, and there's no CSP frame-ancestors directive - so this page can still be embedded in an invisible iframe on another site for a clickjacking attack. Use DENY or SAMEORIGIN, or CSP frame-ancestors to allow specific origins.`,
      scoreImpact: 10,
    });
    deduct(10);
  } else {
    rules.push({
      id: "clickjack-ok",
      name: "Clickjacking protection",
      category: "Clickjacking",
      status: "passed",
      message: xfoResult.reason ? `X-Frame-Options: ${xfo} - ${xfoResult.reason}.` : `X-Frame-Options: ${xfo}`,
      scoreImpact: 0,
    });
  }

  // 5. Referrer-Policy
  // W3C Referrer Policy s3 / Fetch "default referrer policy": with no header, current browsers
  // (Chrome 85+, Firefox 87+, Safari 15+) apply strict-origin-when-cross-origin - the value most
  // guides recommend setting anyway. So a missing header is only a minor warning (-2, down from
  // -5): it still leaves older browsers on their old no-referrer-when-downgrade default, which
  // sends the full URL to other HTTPS sites.
  const referrerPolicy = get(headers, "referrer-policy");
  if (!referrerPolicy) {
    rules.push({
      id: "referrer-missing",
      name: "Referrer-Policy",
      category: "Privacy",
      status: "warning",
      message: "Missing - a minor issue. Current browsers then default to strict-origin-when-cross-origin (other sites only see your domain, never the full URL), which is the commonly recommended value. Setting it explicitly still matters for older browsers, whose default sends the full URL, path and query string included, to other HTTPS sites.",
      scoreImpact: 2,
    });
    deduct(2);
  } else {
    rules.push({
      id: "referrer-ok",
      name: "Referrer-Policy",
      category: "Privacy",
      status: "passed",
      message: `Set to "${referrerPolicy}".`,
      scoreImpact: 0,
    });
  }

  // 6. Permissions-Policy
  const permissionsPolicy = get(headers, "permissions-policy");
  if (!permissionsPolicy) {
    rules.push({
      id: "permissions-missing",
      name: "Permissions-Policy",
      category: "Privacy",
      status: "warning",
      message: "Missing. This header lets a site explicitly disable browser features (camera, microphone, geolocation, etc.) it doesn't use, closing off a class of abuse via injected or third-party scripts.",
      scoreImpact: 5,
    });
    deduct(5);
  } else {
    rules.push({
      id: "permissions-ok",
      name: "Permissions-Policy",
      category: "Privacy",
      status: "passed",
      message: "Present.",
      scoreImpact: 0,
    });
  }

  // 7. Server / X-Powered-By - information disclosure. OWASP's HTTP Headers Cheat Sheet asks
  // for "non-informative values" in Server and for X-Powered-By to be removed. A Server value
  // without a version ("cloudflare", "nginx") names a product but not which known
  // vulnerabilities apply, so only a versioned Server value counts as disclosure.
  const rawServer = get(headers, "server");
  const server = rawServer && SERVER_VERSION.test(rawServer) ? rawServer : undefined;
  const poweredBy = get(headers, "x-powered-by");
  if (server || poweredBy) {
    const parts = [server && `Server: ${server}`, poweredBy && `X-Powered-By: ${poweredBy}`].filter(Boolean);
    rules.push({
      id: "info-disclosure",
      name: "Server info disclosure",
      category: "Disclosure",
      status: "warning",
      message: `${parts.join(", ")} - reveals the software/version running, which narrows down which known vulnerabilities to try. Most frameworks let you suppress or generalize this.`,
      scoreImpact: 5,
    });
    deduct(5);
  } else {
    rules.push({
      id: "info-ok",
      name: "Server info disclosure",
      category: "Disclosure",
      status: "passed",
      message: "No Server or X-Powered-By header revealing the software stack.",
      scoreImpact: 0,
    });
  }

  const clamped = Math.max(0, Math.min(100, score));
  return { score: clamped, rating: ratingFor(clamped), rules };
}
