// Fonts first, so the loading screen and the app paint in Azeret Mono / Ubuntu.
import "@crowhr/ui/fonts.css";
import { createDemoClient, type DemoClient, interceptFetch } from "@crowhr/demo/client";
import type { BootStage, BootTimings, DemoInfo, WireRequest } from "@crowhr/demo/protocol";
import DemoWorker from "@crowhr/demo/worker?worker";
import { setAppClockOffset } from "@crowhr/ui/clock";
import { configureWebForDemo } from "./web-extensions.tsx";

/**
 * Boot sequence of the public demo:
 * 1. Take the per-browser lock (one tab owns the database; others offer to take over).
 * 2. Start the worker: PGlite on IndexedDB, a snapshot on first visit (real seed fallback), the real core app.
 * 3. Route `/api/*` from this page (patched fetch) and from the service worker (images,
 *    downloads) to the worker.
 * 4. Start apps/web's own entry, unchanged, with the demo banner above it.
 * The about page (/about-demo) renders without booting the database.
 */
declare const __DEMO_DATA_VERSION__: string;
export const DATA_VERSION = __DEMO_DATA_VERSION__;
const LOCK = "crowhr-demo-database";
const STAGES: BootStage[] = ["wasm", "open", "migrate", "seed", "app"];
/** "count" events (detail: number) when the worker's Demo outbox receives mail. */
const outboxEvents = new EventTarget();

const bootEl = document.getElementById("demo-boot") as HTMLElement;
const bar = document.getElementById("demo-boot-bar") as HTMLElement;

function showStage(stage: BootStage) {
  const at = STAGES.indexOf(stage);
  // "migrate" and "seed" share the third row (only on a first visit).
  const row = stage === "migrate" ? "seed" : stage;
  for (const li of document.querySelectorAll<HTMLElement>("#demo-boot-steps li")) {
    const liAt = STAGES.indexOf(li.dataset.stage as BootStage);
    li.dataset.state = li.dataset.stage === row ? "active" : liAt < at ? "done" : "";
  }
  bar.style.width = `${Math.max(6, Math.round(((at + 1) / STAGES.length) * 92))}%`;
}

function showError(html: string) {
  const el = document.getElementById("demo-boot-error") as HTMLElement;
  el.innerHTML = html;
  el.hidden = false;
  bootEl.hidden = false;
}

async function bootDemo(): Promise<{ client: DemoClient; timings: BootTimings; info: DemoInfo }> {
  const worker = new DemoWorker();
  const client = createDemoClient(worker, {
    onProgress: (stage) => showStage(stage),
    onOutbox: (count) => outboxEvents.dispatchEvent(new CustomEvent("count", { detail: count })),
  });
  showStage("wasm");
  const { timings, info } = await client.boot(location.origin, DATA_VERSION);
  return { client, timings, info };
}

/** Answers API requests the service worker caught (receipt images, PDF and CSV downloads). */
function serveServiceWorker(client: DemoClient) {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.addEventListener("message", (event: MessageEvent) => {
    const data = event.data as { type?: string; wire?: WireRequest } | null;
    const port = event.ports[0];
    if (data?.type !== "crowhr-demo-request" || !data.wire || !port) return;
    client.send(data.wire).then(
      (res) => port.postMessage({ ok: true, res }, [res.body]),
      () => port.postMessage({ ok: false }),
    );
  });
  navigator.serviceWorker.register("/demo-sw.js", { scope: "/" }).catch((err: unknown) => {
    console.warn("Demo service worker not available; receipt previews and downloads may not work.", err);
  });
}

function startTicking(client: DemoClient) {
  // Core's scheduled sweep (reminders, escalations, email outbox): every 30 s and on navigation.
  const tick = () => void client.tick().catch(() => undefined);
  setInterval(tick, 30_000);
  let last = location.pathname;
  const onNav = () => {
    if (location.pathname !== last) {
      last = location.pathname;
      tick();
    }
  };
  window.addEventListener("popstate", onNav);
  for (const method of ["pushState", "replaceState"] as const) {
    const original = history[method].bind(history);
    history[method] = (...args: Parameters<History["pushState"]>) => {
      original(...args);
      onNav();
    };
  }
}

async function runApp() {
  const t0 = performance.now();
  const { client, timings, info } = await bootDemo();
  interceptFetch(client);
  serveServiceWorker(client);
  startTicking(client);
  const bootMs = Math.round(performance.now() - t0);
  // For the e2e (and anyone curious): how long this load took.
  const record = { timings, info, bootMs, readyMs: 0 };
  (window as unknown as { __crowhrDemo: unknown }).__crowhrDemo = record;
  configureWebForDemo();
  // The app's own "today" (default weeks, months and dates) must match the demo company's clock.
  setAppClockOffset(info.clockOffsetMs);
  showStage("app");
  // apps/web's entry renders into #root as soon as it is imported.
  await import("../../web/src/main.tsx");
  const { mountBanner } = await import("./banner.tsx");
  mountBanner({ client, info, outboxEvents });
  bootEl.hidden = true;
  // Navigation start → app on screen (performance.now() counts from navigation start).
  record.readyMs = Math.round(performance.now());
  document.title = "Crow HR demo";
}

function otherTab(take: () => void) {
  const el = document.getElementById("demo-boot-error") as HTMLElement;
  showError(
    "The demo is open in another tab of this browser. It can only run in one tab at a time, because both would write the same local database. " +
      '<button type="button" id="demo-take-over">Use it here instead</button>',
  );
  el.querySelector("#demo-take-over")?.addEventListener("click", take, { once: true });
  bar.style.width = "0%";
}

async function main() {
  if (location.pathname === "/about-demo") {
    const { mountAboutPage } = await import("./about.tsx");
    bootEl.hidden = true;
    mountAboutPage(DATA_VERSION);
    return;
  }
  if (!("indexedDB" in window) || !("Worker" in window)) {
    showError(
      "This browser can't run the demo (it needs IndexedDB and Web Workers). Try a current Chrome, Edge, Firefox or Safari.",
    );
    return;
  }
  const run = () =>
    runApp().catch((err: unknown) => {
      console.error(err);
      showError(
        `The demo couldn't start: ${String(err instanceof Error ? err.message : err).replace(/</g, "&lt;")}. ` +
          '<button type="button" id="demo-reload">Reload</button> or <a href="/about-demo">read about the demo</a>.',
      );
      document.getElementById("demo-reload")?.addEventListener("click", () => location.reload());
    });
  if (!navigator.locks) {
    await run();
    return;
  }
  const hold = (steal: boolean) =>
    navigator.locks
      .request(LOCK, steal ? { steal: true } : { ifAvailable: true }, async (lock) => {
        if (!lock) {
          otherTab(() => void hold(true));
          return;
        }
        await run();
        // Keep the lock while this tab lives. If another tab takes it, this request rejects.
        await new Promise(() => undefined);
      })
      .catch(() => {
        // Another tab took over: stop using the database here.
        document.body.innerHTML =
          '<div style="padding:32px 16px;font:14px/1.5 system-ui,sans-serif;max-width:480px;margin:auto">' +
          "<p><strong>The demo moved to another tab.</strong> Close this tab, or reload it to take the demo back.</p></div>";
      });
  await hold(false);
}

void main();
