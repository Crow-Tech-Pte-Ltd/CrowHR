import { type AssistantTransport, assistantTools, readAssistantTool, VERSION } from "@crowhr/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";

export const serveAssistant: AssistantTransport = async (c) => {
  if (c.req.method !== "POST") return c.body(null, 405, { allow: "POST" });
  const server = new McpServer({ name: "Crow HR", version: VERSION });
  for (const name of Object.keys(assistantTools) as Array<keyof typeof assistantTools>) {
    server.registerTool(
      name,
      {
        description: assistantTools[name].description,
        inputSchema: z.strictObject({}),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      async () => {
        try {
          const data = JSON.parse(JSON.stringify(await readAssistantTool(c, name))) as Record<string, unknown>;
          return { content: [{ type: "text", text: JSON.stringify(data) }], structuredContent: data };
        } catch {
          c.var.logger.warn("AI assistant tool could not answer", { tool: name });
          return {
            isError: true,
            content: [{ type: "text", text: "Crow HR could not answer this request. Check your access in Crow HR." }],
          };
        }
      },
    );
  }
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  await server.connect(transport);
  try {
    return await transport.handleRequest(c.req.raw);
  } finally {
    await server.close();
  }
};
