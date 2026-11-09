import type { LogFields, Logger, LogLevel } from "@crowhr/core";
import type { Monitoring } from "./sentry.ts";

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MAX_ATTRIBUTE_LENGTH = 2000;

/**
 * Tees the app's logger into monitoring. Entries at or above `minLevel` become Sentry logs
 * (when `logs` is on), and every `error` entry becomes an issue: the Error in its fields when
 * there is one (core's "Unhandled error" for 500s, background job failures), else the message.
 * The console output is unchanged. Monitoring failures never break logging.
 *
 * Errors are captured one tick later: for a failed request the Hono integration reports the
 * same Error first, named after the route, and the SDK then skips the second capture.
 */
export function withMonitoring(
  logger: Logger,
  monitoring: Monitoring,
  options: { logs: boolean; minLevel: LogLevel },
): Logger {
  const wrap = (inner: Logger, base: LogFields): Logger => {
    const emit = (level: LogLevel) => (message: string, fields?: LogFields) => {
      inner[level](message, fields);
      if (ORDER[level] < ORDER[options.minLevel]) return;
      try {
        const all = { ...base, ...fields };
        if (options.logs) monitoring.log(level, message, toAttributes(all));
        if (level !== "error") return;
        const errorKey = Object.keys(all).find((k) => all[k] instanceof Error);
        if (errorKey) {
          const { [errorKey]: err, ...rest } = all;
          const extra = { message, ...toAttributes(rest) };
          if (typeof all.requestId === "string") monitoring.tagRequest(all.requestId);
          setImmediate(() => {
            try {
              monitoring.captureException(err, extra);
            } catch {
              // Reporting is best effort.
            }
          });
        } else {
          monitoring.captureMessage(message, toAttributes(all));
        }
      } catch {
        // Reporting is best effort.
      }
    };
    return {
      debug: emit("debug"),
      info: emit("info"),
      warn: emit("warn"),
      error: emit("error"),
      child: (fields) => wrap(inner.child(fields), { ...base, ...fields }),
    };
  };
  return wrap(logger, {});
}

/** Log attributes must be flat primitives. Errors keep name and message (the stack goes to issues). */
export function toAttributes(fields: LogFields): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null) continue;
    if (typeof value === "string") out[key] = clip(value);
    else if (typeof value === "number" || typeof value === "boolean") out[key] = value;
    else if (value instanceof Error) out[key] = clip(`${value.name}: ${value.message}`);
    else if (value instanceof Date) out[key] = value.toISOString();
    else {
      try {
        out[key] = clip(JSON.stringify(value) ?? String(value));
      } catch {
        out[key] = "[unserialisable]";
      }
    }
  }
  return out;
}

function clip(s: string): string {
  return s.length > MAX_ATTRIBUTE_LENGTH ? `${s.slice(0, MAX_ATTRIBUTE_LENGTH)}…` : s;
}
