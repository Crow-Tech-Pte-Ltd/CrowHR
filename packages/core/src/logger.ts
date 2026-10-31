export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
  /** A logger that adds `fields` to every entry (e.g. `{ requestId }`). */
  child(fields: LogFields): Logger;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LogEntry extends LogFields {
  level: LogLevel;
  message: string;
}

type Sink = (entry: LogEntry) => void;

function makeLogger(sink: Sink, minLevel: LogLevel, base: LogFields): Logger {
  const emit = (level: LogLevel, message: string, fields?: LogFields) => {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
    sink({ ...base, ...fields, level, message });
  };
  return {
    debug: (m, f) => emit("debug", m, f),
    info: (m, f) => emit("info", m, f),
    warn: (m, f) => emit("warn", m, f),
    error: (m, f) => emit("error", m, f),
    child: (fields) => makeLogger(sink, minLevel, { ...base, ...fields }),
  };
}

/** One JSON object per line on the console. Works in Node and browsers. */
export function createJsonConsoleLogger(options: { level?: LogLevel; base?: LogFields } = {}): Logger {
  return makeLogger(
    (entry) => {
      const line = JSON.stringify({ time: new Date().toISOString(), ...entry }, errorReplacer);
      if (entry.level === "error" || entry.level === "warn") console.error(line);
      // biome-ignore lint/suspicious/noConsole: this is the log sink.
      else console.log(line);
    },
    options.level ?? "info",
    options.base ?? {},
  );
}

/** Captures entries in memory; for tests. */
export function createMemoryLogger(): Logger & { entries: LogEntry[] } {
  const entries: LogEntry[] = [];
  const logger = makeLogger((e) => entries.push(e), "debug", {});
  return Object.assign(logger, { entries });
}

export const noopLogger: Logger = makeLogger(() => {}, "error", {});

function errorReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Error) {
    return { name: value.name, message: value.message, stack: value.stack };
  }
  return value;
}
