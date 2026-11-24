// The JSON-LD node graph shared by the validator (validate.ts) and the product reader
// (products.ts): node paths, @id indexing across blocks, and property lookup that follows @id
// references and merges nodes with the same @id, as JSON-LD does.

import type { JsonNode, JsonObject } from "./json.ts";

export const SCHEMA_ORG_PREFIX = /^(?:https?:\/\/schema\.org\/|schema:)/;

export interface Graph {
  paths: Map<JsonNode, string>;
  ids: Map<string, JsonObject[]>;
}

export function childPath(path: string, key: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`;
}

export function isReference(node: JsonObject): boolean {
  return node.props.size === 1 && node.props.get("@id")?.kind === "string";
}

export function idOf(node: JsonObject): string | null {
  const id = node.props.get("@id");
  return id?.kind === "string" ? id.value : null;
}

/** The node's @type values without a schema.org prefix, or null when @type is malformed. */
export function typesOf(node: JsonObject): string[] | null {
  const type = node.props.get("@type");
  if (!type) return [];
  const items = type.kind === "array" ? type.items : [type];
  const types = items.map((item) => (item.kind === "string" ? item.value.trim().replace(SCHEMA_ORG_PREFIX, "") : ""));
  return types.length && types.every(Boolean) ? types : null;
}

/** Records every node's path and indexes nodes that define an @id. @context is not data. */
export function index(graph: Graph, node: JsonNode, path: string): void {
  graph.paths.set(node, path);
  if (node.kind === "array") node.items.forEach((item, i) => index(graph, item, `${path}[${i}]`));
  if (node.kind !== "object") return;
  const id = idOf(node);
  if (id !== null && !isReference(node) && [...node.props.keys()].some((k) => k !== "@id" && k !== "@context")) {
    const list = graph.ids.get(id);
    if (list) list.push(node);
    else graph.ids.set(id, [node]);
  }
  for (const [key, value] of node.props) {
    if (key !== "@context") index(graph, value, childPath(path, key));
  }
}

// The properties of all nodes with one @id, the first node's value winning, built on first use
// so that a lookup doesn't scan every node with that @id (a page can repeat one @id many times).
const merged = new WeakMap<Graph, Map<string, Map<string, JsonNode>>>();

function mergedProps(graph: Graph, id: string): Map<string, JsonNode> | undefined {
  let byId = merged.get(graph);
  if (!byId) merged.set(graph, (byId = new Map()));
  let props = byId.get(id);
  if (!props) {
    const nodes = graph.ids.get(id);
    if (!nodes) return undefined;
    props = new Map();
    for (const other of nodes) for (const [key, value] of other.props) if (!props.has(key)) props.set(key, value);
    byId.set(id, props);
  }
  return props;
}

/** A property of the node, or of another node with the same @id: JSON-LD merges them. */
export function propertyOf(graph: Graph, node: JsonObject, key: string): JsonNode | undefined {
  const own = node.props.get(key);
  const id = idOf(node);
  if (own || id === null) return own;
  return mergedProps(graph, id)?.get(key);
}

/** Present values of a property: arrays flattened, @id references resolved, empty values dropped. */
export function valuesOf(graph: Graph, node: JsonObject, key: string): JsonNode[] {
  const value = propertyOf(graph, node, key);
  if (!value) return [];
  const out: JsonNode[] = [];
  for (const item of value.kind === "array" ? value.items : [value]) {
    if (item.kind === "null" || (item.kind === "string" && !item.value.trim()) || (item.kind === "array" && !item.items.length)) continue;
    out.push(item.kind === "object" && isReference(item) ? (graph.ids.get(idOf(item)!)?.[0] ?? item) : item);
  }
  return out;
}
