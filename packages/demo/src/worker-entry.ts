import type { FromWorker, ToWorker } from "./protocol.ts";

/**
 * The demo worker's entry script (`new Worker(…, { type: "module" })`). It only holds the messages
 * that arrive early and loads worker.ts, so no other chunk ever imports this file.
 *
 * Why: the bundler moves code that worker.ts shares with its lazily loaded chunks (PGlite, the
 * runtime) into the chunk that holds worker.ts, and those chunks import it back. WebKit (Safari)
 * evaluates a module worker's entry script a second time when another module imports it. That
 * second copy, which has no database, took over `onmessage`, so every request failed with "The
 * demo is still starting". As an ordinary chunk, worker.ts is evaluated once in every browser.
 * apps/demo/scripts/check-bundle.ts fails the build if a chunk imports this entry again.
 */
declare const self: DedicatedWorkerGlobalScope;

const early: MessageEvent<ToWorker>[] = [];
self.onmessage = (event: MessageEvent<ToWorker>) => {
  early.push(event);
};

import("./worker.ts").then(
  ({ listen }) => listen(early),
  (err: unknown) => {
    const message = `the demo's code didn't load (${err instanceof Error ? err.message : String(err)})`;
    const fail = (event: MessageEvent<ToWorker>) =>
      self.postMessage({ id: event.data.id, error: { message } } satisfies FromWorker);
    for (const event of early.splice(0)) fail(event);
    self.onmessage = fail;
  },
);
