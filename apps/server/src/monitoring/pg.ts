import pg from "pg";
import type { StartDatabaseSpan } from "./sentry.ts";

/** Instrument the pool's own clients, including the client used for a transaction. */
export function tracingPgClient(startSpan: StartDatabaseSpan): typeof pg.Client {
  return class TracingClient extends pg.Client {
    override query = ((...args: unknown[]) => {
      const query = () => Reflect.apply(super.query, this, args);
      // Cursor and streaming queries return their own handle. Crow HR uses text and config queries.
      if (args[0] && typeof (args[0] as { submit?: unknown }).submit === "function") return query();
      const finish = startSpan();
      if (!finish) return query();

      // pg.Pool uses the callback overload internally. Transaction queries return a promise.
      const last = args.length - 1;
      const callback = args[last];
      if (typeof callback === "function") {
        args[last] = (error: Error | null, result: unknown) => {
          finish(Boolean(error));
          callback(error, result);
        };
      }
      try {
        const result = query();
        if (typeof callback === "function") return result;
        return Promise.resolve(result).then(
          (value) => {
            finish(false);
            return value;
          },
          (error: unknown) => {
            finish(true);
            throw error;
          },
        );
      } catch (error) {
        finish(true);
        throw error;
      }
    }) as pg.Client["query"];
  };
}
