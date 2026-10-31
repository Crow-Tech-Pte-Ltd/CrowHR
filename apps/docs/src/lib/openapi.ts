/**
 * Reads the committed OpenAPI snapshot (packages/core/openapi/v1.snapshot.json) into the shape the
 * API reference pages render. Pure functions, used at build time only: the published reference is
 * static HTML with no client-side runtime.
 */
import { apiTagSlug } from "./api-tags.ts";

export type JsonSchema = {
  type?: string | string[];
  format?: string;
  enum?: unknown[];
  const?: unknown;
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
  allOf?: JsonSchema[];
  additionalProperties?: boolean | JsonSchema;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  default?: unknown;
  $ref?: string;
  "x-sensitivity"?: string;
  "x-extensible-enum"?: boolean;
  [key: string]: unknown;
};

export interface Parameter {
  name: string;
  in: "path" | "query" | "header" | "cookie";
  required?: boolean;
  description?: string;
  schema?: JsonSchema;
}

export interface MediaContent {
  schema?: JsonSchema;
}

export interface Response {
  description?: string;
  content?: Record<string, MediaContent>;
}

export interface Operation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  security?: Record<string, string[]>[];
  parameters?: Parameter[];
  requestBody?: { required?: boolean; content?: Record<string, MediaContent> };
  responses?: Record<string, Response>;
  deprecated?: boolean;
  "x-permission"?: string;
  "x-recent-auth"?: boolean;
  "x-error-codes"?: string[];
  [key: string]: unknown;
}

export interface OpenApiDocument {
  openapi: string;
  info: { title: string; version: string; description?: string };
  paths: Record<string, Record<string, Operation>>;
  components?: { schemas?: Record<string, JsonSchema>; securitySchemes?: Record<string, unknown> };
}

export interface OperationEntry {
  method: string;
  path: string;
  op: Operation;
  /** Stable HTML id for deep links, e.g. `get-api-v1-payroll-runs-runid`. */
  anchor: string;
}

export interface TagGroup {
  tag: string;
  slug: string;
  operations: OperationEntry[];
}

const METHODS = ["get", "post", "put", "patch", "delete", "head", "options"] as const;

export function operationAnchor(method: string, path: string): string {
  return `${method}-${path}`
    .toLowerCase()
    .replace(/[{}]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Every operation grouped by its first tag, tags sorted by name, operations by path then method. */
export function groupByTag(doc: OpenApiDocument): TagGroup[] {
  const groups = new Map<string, OperationEntry[]>();
  for (const [path, ops] of Object.entries(doc.paths)) {
    for (const method of METHODS) {
      const op = ops[method];
      if (!op) continue;
      const tag = op.tags?.[0] ?? "Other";
      const list = groups.get(tag) ?? [];
      list.push({ method, path, op, anchor: operationAnchor(method, path) });
      groups.set(tag, list);
    }
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([tag, operations]) => ({
      tag,
      slug: apiTagSlug(tag),
      operations: operations.sort(
        (a, b) =>
          a.path.localeCompare(b.path) ||
          METHODS.indexOf(a.method as (typeof METHODS)[number]) - METHODS.indexOf(b.method as (typeof METHODS)[number]),
      ),
    }));
}

/** Resolves a local `#/components/schemas/X` reference; other schemas are returned unchanged. */
export function deref(doc: OpenApiDocument, schema: JsonSchema | undefined): JsonSchema | undefined {
  if (!schema?.$ref) return schema;
  const name = schema.$ref.replace("#/components/schemas/", "");
  return doc.components?.schemas?.[name] ?? schema;
}

/** Drops `null` from an anyOf and reports whether it was there, so `string | null` reads as "string, nullable". */
export function splitNullable(schema: JsonSchema): { schema: JsonSchema; nullable: boolean } {
  const variants = schema.anyOf ?? schema.oneOf;
  if (!variants) return { schema, nullable: false };
  const nonNull = variants.filter((v) => v.type !== "null");
  if (nonNull.length === variants.length) return { schema, nullable: false };
  if (nonNull.length === 1) {
    const only = nonNull[0] as JsonSchema;
    return { schema: { ...only, description: only.description ?? schema.description }, nullable: true };
  }
  return { schema: { ...schema, anyOf: nonNull, oneOf: undefined }, nullable: true };
}

/** A short human type label: `string (uuid)`, `integer`, `array of object`, `"a" | "b"`. */
export function typeLabel(schema: JsonSchema | undefined): string {
  if (!schema) return "any";
  const { schema: s, nullable } = splitNullable(schema);
  let label: string;
  if (s.const !== undefined) label = JSON.stringify(s.const);
  else if (s.enum) label = "enum";
  else if (s.anyOf || s.oneOf) label = (s.anyOf ?? s.oneOf ?? []).map((v) => typeLabel(v)).join(" | ");
  else if (s.allOf) label = "object";
  else if (s.type === "array") label = `array of ${typeLabel(s.items)}`;
  else if (Array.isArray(s.type)) label = s.type.join(" | ");
  else if (s.type) label = s.format ? `${s.type} (${s.format})` : s.type;
  else if (s.properties) label = "object";
  else label = "any";
  return nullable ? `${label} or null` : label;
}

/** Child properties to render under a schema (objects, arrays of objects, allOf merges). */
export function childProperties(
  schema: JsonSchema | undefined,
): { name: string; schema: JsonSchema; required: boolean }[] {
  if (!schema) return [];
  const { schema: s } = splitNullable(schema);
  if (s.type === "array" && s.items) return childProperties(s.items);
  const merged: JsonSchema = s.allOf ? Object.assign({}, ...s.allOf.map((p) => splitNullable(p).schema)) : s;
  const props = merged.properties ?? {};
  const required = new Set(merged.required ?? []);
  return Object.entries(props).map(([name, child]) => ({ name, schema: child, required: required.has(name) }));
}

/** Constraints worth showing next to a field (enum values, bounds, default). Patterns are omitted: they repeat the format. */
export function constraints(schema: JsonSchema): string[] {
  const { schema: s } = splitNullable(schema);
  const out: string[] = [];
  if (s.enum) out.push(`one of ${s.enum.map((v) => JSON.stringify(v)).join(", ")}`);
  if (s["x-extensible-enum"]) out.push("more values may be added");
  if (s.minimum !== undefined) out.push(`min ${s.minimum}`);
  if (s.maximum !== undefined && s.maximum < Number.MAX_SAFE_INTEGER) out.push(`max ${s.maximum}`);
  if (s.minLength !== undefined && s.minLength > 0) out.push(`min length ${s.minLength}`);
  if (s.maxLength !== undefined) out.push(`max length ${s.maxLength}`);
  if (s.default !== undefined) out.push(`default ${JSON.stringify(s.default)}`);
  return out;
}

export function sensitivity(schema: JsonSchema): string | undefined {
  const value = schema["x-sensitivity"] ?? splitNullable(schema).schema["x-sensitivity"];
  return typeof value === "string" ? value : undefined;
}

export function isPublic(op: Operation): boolean {
  return Array.isArray(op.security) && op.security.length === 0;
}
