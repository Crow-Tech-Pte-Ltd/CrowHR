import type { MiddlewareHandler } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { AppEnv } from "../context.ts";
import { AppError } from "../errors.ts";
import { type ApiModule, fullPath } from "./route.ts";

export const DEFAULT_BODY_BYTES = 1024 * 1024;
export const isJsonContentType = (type: string) => /^application\/(?:[\w.+-]+\+)?json\s*(?:;|$)/i.test(type);

/** One limit for the entire app, including unknown routes. Only declared uploads can raise it. */
export function requestBodyLimit(modules: readonly ApiModule[]): MiddlewareHandler<AppEnv> {
  const routes = modules.flatMap((m) =>
    m.routes
      .filter((r) => r.request?.body || r.maxBodyBytes)
      .map((r) => ({
        method: r.method.toUpperCase(),
        json: !!r.request?.body,
        max: r.maxBodyBytes ?? DEFAULT_BODY_BYTES,
        path: new RegExp(
          `^${fullPath(m, r)
            .split("/")
            .map((part) => (part.startsWith(":") ? "[^/]+" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")))
            .join("/")}/?$`,
        ),
      })),
  );
  return async (c, next) => {
    const route = routes.find((r) => r.method === c.req.method && r.path.test(c.req.path));
    // Reject JSON impostors before bodyLimit can buffer a chunked stream.
    if (route?.json && c.req.raw.body && !isJsonContentType(c.req.header("content-type") ?? "")) {
      throw new AppError(
        "validation_failed",
        "Send the request body as JSON with the header Content-Type: application/json.",
      );
    }
    return bodyLimit({
      maxSize: route?.max ?? DEFAULT_BODY_BYTES,
      onError: () => {
        throw new AppError(
          "file_too_large",
          "The request body is too large. Send a smaller request or use the file upload endpoint.",
          { maxBytes: route?.max ?? DEFAULT_BODY_BYTES },
        );
      },
    })(c, next);
  };
}
