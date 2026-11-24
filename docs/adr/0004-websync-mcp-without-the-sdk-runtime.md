# ADR 0004: websync-mcp implements the stdio protocol itself; the official SDK is a test dependency

- Status: accepted
- Date: 2026-11-24

## Context

`websync-mcp` exposes the four packages to MCP clients. The obvious route is the official
`@modelcontextprotocol/sdk` (1.32.2). Its runtime dependencies include `express`, `hono`,
`@hono/node-server`, `cors`, `jose`, `ajv`, `eventsource`, `express-rate-limit` and
`cross-spawn` (`npm view`, 24 November 2026). Most of these serve HTTP transports and OAuth,
which a local stdio server doesn't use. Every other package here has no third-party runtime
dependency (ADR 0001, 0003).

The server needs a small part of the protocol: the `initialize` handshake with version
negotiation, `ping`, `tools/list` and `tools/call`, over newline-delimited JSON-RPC 2.0 on
stdio.

## Decision

- Implement that part directly: `src/server.ts` (message handling, about 120 lines, no I/O)
  and `src/cli.ts` (stdio framing).
- Use the official SDK **only as a dev dependency**, in a compliance test where the SDK's own
  `Client` and `StdioClientTransport` start the real server, negotiate, list tools, call
  every tool, and get both tool errors and protocol errors back.
- Tools take text, never URLs or paths, so the server has no network or filesystem surface
  (SECURITY-MODEL.md, library tier).

## Consequences

- No third-party code runs in the server. Installing it pulls only the four WebSync packages.
- Spec changes are ours to track. The supported versions are listed in `PROTOCOL_VERSIONS`.
  Dependabot bumps of the SDK dev dependency rerun the compliance test against the newest
  client, so a breaking protocol change shows up in CI.
- If the server ever needs HTTP transport, OAuth, resources or sampling, revisit this. At that
  point the SDK earns its dependencies.
- Installing the SDK as a dev dependency hit an npm arborist bug on the existing
  `node_modules` ("Cannot set properties of null (setting 'peer')", npm 10.7 and 11). Fixed by
  regenerating the lockfile from the manifests alone and running `npm ci`. Recorded here in
  case it recurs.
