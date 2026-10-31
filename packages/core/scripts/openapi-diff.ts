/**
 * Structural breaking-change check between two OpenAPI documents (api-platform design
 * decision 2). Pure TypeScript, no network, no Go toolchain.
 *
 * Breaking: a removed path or method; a removed response property; a response property that
 * was required and is now optional; a request property or parameter that was optional and is
 * now required; a newly added required request property or parameter; a type change; a removed
 * enum value; a new enum value in a response unless the schema sets `x-extensible-enum: true`.
 */

type Json = Record<string, unknown>;
export interface OpenApiLike {
  paths: Record<string, Record<string, Json>>;
}

export interface BreakingChange {
  operation: string;
  location: string;
  message: string;
}

const METHODS = ["get", "post", "put", "patch", "delete"];

function asObj(v: unknown): Json {
  return typeof v === "object" && v !== null ? (v as Json) : {};
}

function types(schema: Json): string[] {
  const t = schema.type;
  if (Array.isArray(t)) return [...(t as string[])].sort();
  if (typeof t === "string") return [t];
  return [];
}

function compareSchema(
  base: Json,
  next: Json,
  direction: "request" | "response",
  at: string,
  report: (location: string, message: string) => void,
) {
  const bt = types(base);
  const nt = types(next);
  if (bt.length && nt.length) {
    const lost = direction === "response" ? nt.filter((t) => !bt.includes(t)) : bt.filter((t) => !nt.includes(t));
    if (lost.length || (direction === "response" && nt.length !== bt.length && nt.some((t) => !bt.includes(t)))) {
      report(at, `type changed from ${bt.join("|")} to ${nt.join("|")}`);
      return;
    }
  }
  if (Array.isArray(base.enum)) {
    const nextEnum = Array.isArray(next.enum) ? (next.enum as unknown[]) : null;
    if (nextEnum) {
      for (const v of base.enum as unknown[])
        if (!nextEnum.includes(v)) report(at, `enum value ${JSON.stringify(v)} removed`);
      if (direction === "response" && next["x-extensible-enum"] !== true) {
        for (const v of nextEnum) {
          if (!(base.enum as unknown[]).includes(v))
            report(at, `enum value ${JSON.stringify(v)} added to a closed response enum`);
        }
      }
    }
  }
  const bp = asObj(base.properties);
  const np = asObj(next.properties);
  const breq = new Set((base.required as string[] | undefined) ?? []);
  const nreq = new Set((next.required as string[] | undefined) ?? []);
  for (const key of Object.keys(bp)) {
    const path = at ? `${at}.${key}` : key;
    if (!(key in np)) {
      if (direction === "response") report(path, "removed from the response");
      else if (next.additionalProperties === false) report(path, "no longer accepted in the request");
      continue;
    }
    if (direction === "response" && breq.has(key) && !nreq.has(key))
      report(path, "no longer always present in the response");
    if (direction === "request" && !breq.has(key) && nreq.has(key)) report(path, "changed from optional to required");
    compareSchema(asObj(bp[key]), asObj(np[key]), direction, path, report);
  }
  if (direction === "request") {
    for (const key of Object.keys(np)) {
      if (!(key in bp) && nreq.has(key)) report(at ? `${at}.${key}` : key, "new required request field");
    }
  }
  if (base.items || next.items) compareSchema(asObj(base.items), asObj(next.items), direction, `${at}[]`, report);
  for (const k of ["anyOf", "oneOf", "allOf"]) {
    const ba = (base[k] as Json[] | undefined) ?? [];
    const na = (next[k] as Json[] | undefined) ?? [];
    ba.forEach((s, i) => {
      if (na[i]) compareSchema(asObj(s), asObj(na[i]), direction, at, report);
    });
  }
}

function jsonSchemaOf(container: unknown): Json {
  return asObj(asObj(asObj(asObj(container).content)["application/json"]).schema);
}

export function diffOpenApi(base: OpenApiLike, next: OpenApiLike): BreakingChange[] {
  const changes: BreakingChange[] = [];
  for (const [path, baseItem] of Object.entries(base.paths)) {
    for (const method of METHODS) {
      const baseOp = baseItem[method];
      if (!baseOp) continue;
      const operation = `${method.toUpperCase()} ${path}`;
      const report = (location: string, message: string) => changes.push({ operation, location, message });
      const nextOp = next.paths[path]?.[method];
      if (!nextOp) {
        report("", "operation removed");
        continue;
      }
      // Parameters
      const bParams = new Map(((baseOp.parameters as Json[] | undefined) ?? []).map((p) => [`${p.in}:${p.name}`, p]));
      const nParams = new Map(((nextOp.parameters as Json[] | undefined) ?? []).map((p) => [`${p.in}:${p.name}`, p]));
      for (const [key, np] of nParams) {
        const bp = bParams.get(key);
        const label = `${np.in} parameter ${np.name}`;
        if (!bp && np.required) report(label, "new required parameter");
        if (bp && !bp.required && np.required) report(label, "changed from optional to required");
        if (bp) compareSchema(asObj(bp.schema), asObj(np.schema), "request", label, report);
      }
      // Request body
      const bBody = asObj(baseOp.requestBody);
      const nBody = asObj(nextOp.requestBody);
      if (!baseOp.requestBody && nextOp.requestBody && nBody.required) {
        const schema = jsonSchemaOf(nBody);
        if (((schema.required as string[] | undefined) ?? []).length)
          report("request body", "new required request body");
      }
      if (baseOp.requestBody && nextOp.requestBody) {
        compareSchema(jsonSchemaOf(bBody), jsonSchemaOf(nBody), "request", "", (l, m) =>
          report(l ? `request ${l}` : "request body", m),
        );
      }
      // Success responses
      const bRes = asObj(baseOp.responses);
      const nRes = asObj(nextOp.responses);
      for (const status of Object.keys(bRes).filter((s) => s.startsWith("2"))) {
        if (!(status in nRes)) {
          report(`${status} response`, "response status removed");
          continue;
        }
        compareSchema(jsonSchemaOf(bRes[status]), jsonSchemaOf(nRes[status]), "response", "", (l, m) =>
          report(l || `${status} response`, m),
        );
      }
    }
  }
  return changes;
}

export function formatChanges(changes: BreakingChange[]): string {
  return changes.map((c) => `  - ${c.operation} → ${c.location ? `${c.location}: ` : ""}${c.message}`).join("\n");
}
