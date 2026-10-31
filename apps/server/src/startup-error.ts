/**
 * A startup failure the operator can fix. `main` prints `message` as is (no stack trace)
 * and exits with `exitCode`. Messages say what is wrong and the next command to run.
 */
export class StartupError extends Error {
  override name = "StartupError";
  readonly exitCode: number;
  constructor(message: string, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

/** sysexits.h EX_CONFIG: configuration error. */
export const EX_CONFIG = 78;
/** sysexits.h EX_UNAVAILABLE: a required service (the database) is unavailable. */
export const EX_UNAVAILABLE = 69;
