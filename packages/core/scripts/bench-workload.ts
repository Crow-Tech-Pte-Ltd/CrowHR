import { createHistogram, monitorEventLoopDelay } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";

export interface Operation {
  name: string;
  run(): Promise<void>;
}

export interface WorkloadOptions {
  seconds: number;
  concurrency: number;
  heavyEvery: number;
  reads: Operation[];
  heavy: Operation[];
  resources(): Promise<{ postgresRssKiB: number; databaseBytes: number; waiting: number }>;
}

export async function runWorkload(options: WorkloadOptions, log: (line: string) => void) {
  const histograms = new Map([...options.reads, ...options.heavy].map((op) => [op.name, createHistogram()]));
  const eventLoop = monitorEventLoopDelay({ resolution: 20 });
  const started = performance.now();
  const until = started + options.seconds * 1000;
  let previous = started;
  let cpu = process.cpuUsage();
  let nextHeavy = started;
  let nextSample = started + 10_000;
  let read = 0;
  const measure = async (op: Operation) => {
    const begin = performance.now();
    await op.run();
    histograms.get(op.name)?.record(Math.max(1, Math.round((performance.now() - begin) * 1000)));
  };
  const sample = async () => {
    const now = performance.now();
    const usage = process.cpuUsage(cpu);
    const { rss, heapUsed } = process.memoryUsage();
    log(
      JSON.stringify({
        elapsedSeconds: Math.round((now - started) / 1000),
        appRssBytes: rss,
        appHeapUsedBytes: heapUsed,
        appCpuPercent: Math.round((usage.user + usage.system) / (now - previous) / 10),
        eventLoopP95Ms: Math.round(eventLoop.percentile(95) / 1e6),
        ...(await options.resources()),
      }),
    );
    previous = now;
    cpu = process.cpuUsage();
    eventLoop.reset();
  };

  eventLoop.enable();
  try {
    while (performance.now() < until) {
      const batch = Array.from({ length: options.concurrency }, () => {
        const op = options.reads[read % options.reads.length];
        read++;
        if (!op) throw new Error("The benchmark workload needs at least one read.");
        return measure(op);
      });
      if (performance.now() >= nextHeavy) {
        for (const op of options.heavy) batch.push(measure(op));
        nextHeavy = performance.now() + options.heavyEvery * 1000;
      }
      const complete = await Promise.allSettled(batch);
      for (const result of complete) {
        if (result.status === "rejected") throw result.reason;
      }
      if (performance.now() >= nextSample) {
        await sample();
        nextSample = performance.now() + 10_000;
      }
      const remaining = until - performance.now();
      if (remaining > 0) await delay(Math.min(1000, remaining));
    }
    await sample();
    for (const [name, histogram] of histograms) {
      if (!histogram.count) continue;
      log(
        `${name}: ${histogram.count} samples, p50 ${(histogram.percentile(50) / 1000).toFixed(1)} ms, p95 ${(histogram.percentile(95) / 1000).toFixed(1)} ms, max ${(histogram.max / 1000).toFixed(1)} ms`,
      );
    }
  } finally {
    eventLoop.disable();
  }
}
