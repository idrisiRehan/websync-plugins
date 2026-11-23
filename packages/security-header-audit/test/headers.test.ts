import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { normalizeHeaders, parseRawHeaders } from "../src/headers.ts";

describe("normalizeHeaders", () => {
  test("lower-cases names and trims values", () => {
    assert.deepEqual(normalizeHeaders({ "X-Frame-Options": "  DENY " }), { "x-frame-options": "DENY" });
  });

  test("reads a fetch Headers object", () => {
    const h = new Headers({ "Content-Security-Policy": "default-src 'self'" });
    h.append("X-Content-Type-Options", "nosniff");
    assert.deepEqual(normalizeHeaders(h), {
      "content-security-policy": "default-src 'self'",
      "x-content-type-options": "nosniff",
    });
  });

  test("joins Node-style array values with ', '", () => {
    assert.deepEqual(normalizeHeaders({ "x-content-type-options": ["nosniff", "nosniff"] }), {
      "x-content-type-options": "nosniff, nosniff",
    });
  });

  test("joins repeated names from pair lists, whatever their case", () => {
    const pairs: [string, string][] = [
      ["X-Frame-Options", "DENY"],
      ["x-frame-options", "SAMEORIGIN"],
    ];
    assert.deepEqual(normalizeHeaders(pairs), { "x-frame-options": "DENY, SAMEORIGIN" });
  });

  test("drops undefined and null values, stringifies numbers", () => {
    assert.deepEqual(normalizeHeaders({ a: undefined, b: null, "content-length": 42 }), { "content-length": "42" });
  });

  test("ignores empty names", () => {
    assert.deepEqual(normalizeHeaders([[" ", "x"]]), {});
  });
});

describe("parseRawHeaders", () => {
  test("parses a curl -sI block with CRLF line endings", () => {
    const raw = "HTTP/2 200\r\nserver: nginx\r\nX-Frame-Options: DENY\r\n\r\n";
    assert.deepEqual(parseRawHeaders(raw), { server: "nginx", "x-frame-options": "DENY" });
  });

  test("reads only the last response of a redirect chain (curl -sIL)", () => {
    const raw = [
      "HTTP/1.1 301 Moved Permanently",
      "Location: https://example.com/",
      "Server: old",
      "",
      "HTTP/2 200",
      "strict-transport-security: max-age=63072000",
      "",
    ].join("\n");
    assert.deepEqual(parseRawHeaders(raw), { "strict-transport-security": "max-age=63072000" });
  });

  test("skips an interim 100 Continue response", () => {
    const raw = "HTTP/1.1 100 Continue\n\nHTTP/1.1 200 OK\nReferrer-Policy: no-referrer\n";
    assert.deepEqual(parseRawHeaders(raw), { "referrer-policy": "no-referrer" });
  });

  test("accepts plain Name: value lines without a status line", () => {
    assert.deepEqual(parseRawHeaders("X-Content-Type-Options: nosniff\nPermissions-Policy: camera=()"), {
      "x-content-type-options": "nosniff",
      "permissions-policy": "camera=()",
    });
  });

  test("keeps colons inside values", () => {
    assert.deepEqual(parseRawHeaders("Content-Security-Policy: img-src https://cdn.example.com:8443"), {
      "content-security-policy": "img-src https://cdn.example.com:8443",
    });
  });

  test("joins obsolete folded lines with one space", () => {
    const raw = "HTTP/1.1 200 OK\nContent-Security-Policy: default-src 'self';\n  frame-ancestors 'none'\n\n";
    assert.deepEqual(parseRawHeaders(raw), { "content-security-policy": "default-src 'self'; frame-ancestors 'none'" });
  });

  test("joins a header repeated within one response", () => {
    const raw = "HTTP/1.1 200 OK\nX-Content-Type-Options: nosniff\nX-Content-Type-Options: nosniff\n";
    assert.deepEqual(parseRawHeaders(raw), { "x-content-type-options": "nosniff, nosniff" });
  });

  test("stops at the blank line before a body", () => {
    const raw = "HTTP/1.1 200 OK\nServer: a\n\nnot: a header";
    assert.deepEqual(parseRawHeaders(raw), { server: "a" });
  });

  test("ignores lines that are not headers", () => {
    assert.deepEqual(parseRawHeaders("garbage\n:novalue\nServer: a"), { server: "a" });
  });

  test("returns an empty object for empty input", () => {
    assert.deepEqual(parseRawHeaders(""), {});
  });
});
