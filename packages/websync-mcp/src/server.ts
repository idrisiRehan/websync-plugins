// The Model Context Protocol server: JSON-RPC 2.0 message handling for the methods a
// tools-only server needs (initialize, ping, tools/list, tools/call). Transport-free, so it
// can be tested by passing messages in. stdio wiring lives in cli.ts.
//
// Spec: https://modelcontextprotocol.io/specification (lifecycle, tools, JSON-RPC errors).

import { checkArguments, ToolInputError, type Tool } from "./tools.ts";

/** Protocol versions this server speaks, newest first. */
export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

export interface ServerInfo {
  name: string;
  title: string;
  version: string;
}

type Id = string | number | null;

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: Id;
  result?: unknown;
  error?: { code: number; message: string };
}

// JSON-RPC 2.0 error codes.
const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

const INSTRUCTIONS =
  "Offline WebSync checks. Every tool works on text you pass in and never fetches URLs: to check a live site, fetch the headers, page, sitemap, robots.txt, feed or file yourself and pass the text.";

function isId(value: unknown): value is Id {
  return typeof value === "string" || typeof value === "number" || value === null;
}

function toolResult(data: unknown, isError = false) {
  if (isError) return { content: [{ type: "text", text: String(data) }], isError: true };
  return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
}

export function createServer(tools: Tool[], info: ServerInfo) {
  const byName = new Map(tools.map((t) => [t.name, t]));
  const listed = tools.map(({ name, title, description, inputSchema }) => ({
    name,
    title,
    description,
    inputSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }));

  function call(method: string, params: Record<string, unknown>): unknown {
    switch (method) {
      case "initialize": {
        const requested = params.protocolVersion;
        const protocolVersion = typeof requested === "string" && PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0];
        return { protocolVersion, capabilities: { tools: { listChanged: false } }, serverInfo: info, instructions: INSTRUCTIONS };
      }
      case "ping":
        return {};
      case "tools/list":
        return { tools: listed };
      case "tools/call": {
        const tool = typeof params.name === "string" ? byName.get(params.name) : undefined;
        if (!tool) throw Object.assign(new Error(`Unknown tool: ${String(params.name)}`), { code: INVALID_PARAMS });
        try {
          return toolResult(tool.run(checkArguments(tool, params.arguments)));
        } catch (error) {
          if (error instanceof ToolInputError) return toolResult(error.message, true);
          throw error;
        }
      }
      default:
        throw Object.assign(new Error(`Method not found: ${method}`), { code: METHOD_NOT_FOUND });
    }
  }

  /** Handles one incoming JSON-RPC message (as a parsed value). Returns the response, or null for notifications and responses. */
  function handle(message: unknown): JsonRpcResponse | null {
    if (typeof message !== "object" || message === null || Array.isArray(message)) {
      return { jsonrpc: "2.0", id: null, error: { code: INVALID_REQUEST, message: "Expected a JSON-RPC object." } };
    }
    const msg = message as Record<string, unknown>;
    if (typeof msg.method !== "string") return null; // a response to us; this server sends no requests
    if (!("id" in msg)) return null; // a notification (initialized, cancelled): nothing to answer
    const id = isId(msg.id) ? msg.id : null;
    if (msg.jsonrpc !== "2.0" || !isId(msg.id)) {
      return { jsonrpc: "2.0", id, error: { code: INVALID_REQUEST, message: "Invalid JSON-RPC request." } };
    }
    const params = typeof msg.params === "object" && msg.params !== null ? (msg.params as Record<string, unknown>) : {};
    try {
      return { jsonrpc: "2.0", id, result: call(msg.method, params) };
    } catch (error) {
      const code = (error as { code?: number }).code ?? INTERNAL_ERROR;
      // Internal errors get a fixed message: stack traces and paths stay out of the response.
      const text = code === INTERNAL_ERROR ? "Internal error." : (error as Error).message;
      return { jsonrpc: "2.0", id, error: { code, message: text } };
    }
  }

  /** Handles one line of input text. */
  function handleLine(line: string): JsonRpcResponse | null {
    if (line.trim() === "") return null;
    let message: unknown;
    try {
      message = JSON.parse(line);
    } catch {
      return { jsonrpc: "2.0", id: null, error: { code: PARSE_ERROR, message: "Parse error." } };
    }
    return handle(message);
  }

  return { handle, handleLine };
}
