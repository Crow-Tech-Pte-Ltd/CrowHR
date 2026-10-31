import { describe, expect, it } from "vitest";
import { diffOpenApi, formatChanges, type OpenApiLike } from "./openapi-diff.ts";

const employeeResponse = (props: Record<string, unknown>, required: string[]) => ({
  200: {
    description: "ok",
    content: { "application/json": { schema: { type: "object", properties: props, required } } },
  },
});

function doc(op: Record<string, unknown>, extraPaths: Record<string, unknown> = {}): OpenApiLike {
  return { paths: { "/api/v1/employees/{id}": { get: op }, ...extraPaths } as OpenApiLike["paths"] };
}

const base = doc(
  {
    parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
    responses: employeeResponse(
      {
        id: { type: "string" },
        preferredName: { type: "string" },
        status: { type: "string", enum: ["active", "former"] },
      },
      ["id", "status"],
    ),
  },
  {
    "/api/v1/employees": {
      post: {
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  nickname: { type: "string" },
                  kind: { type: "string", enum: ["a", "b"] },
                },
                required: ["name"],
              },
            },
          },
        },
        responses: { 201: { description: "created" } },
      },
    },
  },
);

const clone = (): OpenApiLike => JSON.parse(JSON.stringify(base));
// biome-ignore lint/suspicious/noExplicitAny: test surgery on JSON.
const at = (d: OpenApiLike, path: string, method: string) => d.paths[path]?.[method] as any;

describe("openapi diff", () => {
  it("reports nothing for identical documents", () => {
    expect(diffOpenApi(base, clone())).toEqual([]);
  });

  it("flags a removed path", () => {
    const next = clone();
    delete next.paths["/api/v1/employees"];
    expect(diffOpenApi(base, next)).toEqual([
      { operation: "POST /api/v1/employees", location: "", message: "operation removed" },
    ]);
  });

  it("flags a removed response field, naming the operation and field", () => {
    const next = clone();
    delete at(next, "/api/v1/employees/{id}", "get").responses[200].content["application/json"].schema.properties
      .preferredName;
    const changes = diffOpenApi(base, next);
    expect(formatChanges(changes)).toBe("  - GET /api/v1/employees/{id} → preferredName: removed from the response");
  });

  it("flags optional → required in a request", () => {
    const next = clone();
    at(next, "/api/v1/employees", "post").requestBody.content["application/json"].schema.required = [
      "name",
      "nickname",
    ];
    expect(diffOpenApi(base, next)[0]?.message).toBe("changed from optional to required");
  });

  it("flags a new required request field and a new required parameter", () => {
    const next = clone();
    const schema = at(next, "/api/v1/employees", "post").requestBody.content["application/json"].schema;
    schema.properties.uen = { type: "string" };
    schema.required = ["name", "uen"];
    at(next, "/api/v1/employees/{id}", "get").parameters.push({
      name: "as",
      in: "query",
      required: true,
      schema: { type: "string" },
    });
    expect(
      diffOpenApi(base, next)
        .map((c) => c.message)
        .sort(),
    ).toEqual(["new required parameter", "new required request field"]);
  });

  it("flags a type change", () => {
    const next = clone();
    at(next, "/api/v1/employees/{id}", "get").responses[200].content["application/json"].schema.properties.id = {
      type: "integer",
    };
    expect(diffOpenApi(base, next)[0]?.message).toBe("type changed from string to integer");
  });

  it("flags a removed enum value", () => {
    const next = clone();
    at(next, "/api/v1/employees", "post").requestBody.content["application/json"].schema.properties.kind.enum = ["a"];
    expect(diffOpenApi(base, next)[0]?.message).toBe('enum value "b" removed');
  });

  it("accepts an added optional field, a new endpoint and a new optional parameter", () => {
    const next = clone();
    at(next, "/api/v1/employees", "post").requestBody.content["application/json"].schema.properties.notes = {
      type: "string",
    };
    at(next, "/api/v1/employees/{id}", "get").responses[200].content["application/json"].schema.properties.photoUrl = {
      type: "string",
    };
    at(next, "/api/v1/employees/{id}", "get").parameters.push({
      name: "expand",
      in: "query",
      required: false,
      schema: { type: "string" },
    });
    next.paths["/api/v1/teams"] = { get: { responses: {} } };
    expect(diffOpenApi(base, next)).toEqual([]);
  });

  it("flags a new value in a closed response enum but not an extensible one", () => {
    const next = clone();
    const status = at(next, "/api/v1/employees/{id}", "get").responses[200].content["application/json"].schema
      .properties.status;
    status.enum = ["active", "former", "suspended"];
    expect(diffOpenApi(base, next)).toHaveLength(1);
    status["x-extensible-enum"] = true;
    expect(diffOpenApi(base, next)).toEqual([]);
  });
});
