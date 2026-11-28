import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { expect, it } from "vitest";

async function listen(server: Server): Promise<number> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as AddressInfo).port;
}

// The self-host job supplies a disposable database and runs all database tests sequentially.
const databaseUrl = process.env.CROWHR_TEST_POSTGRES_URL;
it.skipIf(!databaseUrl)("sends redacted Bun errors, logs, HTTP transactions and PostgreSQL spans", async () => {
  const database = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  const reset = () =>
    database.query("drop schema if exists drizzle cascade; drop schema public cascade; create schema public;");
  await reset();
  const dataDir = await mkdtemp(join(tmpdir(), "crowhr-bun-monitoring-"));
  const envelopes: string[] = [];
  const collector = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    envelopes.push(Buffer.concat(chunks).toString("utf8"));
    res.writeHead(200).end("{}");
  });
  const collectorPort = await listen(collector);
  const portProbe = createServer();
  const appPort = await listen(portProbe);
  await new Promise<void>((resolve) => portProbe.close(() => resolve()));
  const appUrl = `http://127.0.0.1:${appPort}`;
  const source = (path: string) => fileURLToPath(new URL(path, import.meta.url));
  const app = spawn(
    "bun",
    [
      "--no-env-file",
      "--no-install",
      "--import",
      source("../instrument.ts"),
      source("../../testing/bun-integration-server.ts"),
    ],
    {
      env: {
        PATH: process.env.PATH,
        NODE_ENV: "development",
        PUBLIC_URL: appUrl,
        HOST: "127.0.0.1",
        PORT: String(appPort),
        DATABASE_URL: databaseUrl,
        DATA_DIR: dataDir,
        BACKUP_TIME: "off",
        SETUP_GATE: "false",
        SENTRY_DSN: `http://0123456789abcdef@127.0.0.1:${collectorPort}/1`,
        SENTRY_TRACES_SAMPLE_RATE: "1",
        SENTRY_ENABLE_LOGS: "true",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let startupLog = "";
  app.stdout.on("data", (chunk: Buffer) => {
    startupLog = `${startupLog}${chunk}`.slice(-3000);
  });
  app.stderr.on("data", (chunk: Buffer) => {
    startupLog = `${startupLog}${chunk}`.slice(-3000);
  });
  const closed = once(app, "close");
  try {
    await expect
      .poll(
        async () => {
          if (app.exitCode !== null) throw new Error(`Bun server exited during startup:\n${startupLog}`);
          return (await fetch(`${appUrl}/api/health`).catch(() => null))?.status;
        },
        { timeout: 8000 },
      )
      .toBe(200);
    const marker = "private-bound-value-6728";
    const request = (mode: string) =>
      fetch(`${appUrl}/api/v1/monitoring-test/${mode}?token=private-query-string-3993`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: "session=private-cookie-2923" },
        body: JSON.stringify({ marker }),
      });
    expect((await request("read")).status).toBe(204);
    expect((await request("invalid")).status).toBe(400);
    const failed = await request("fail");
    expect(failed.status).toBe(500);
    const requestId = failed.headers.get("x-request-id");
    expect(requestId).toBeTruthy();
    await fetch(`${appUrl}/some-static-resource`).then((response) => response.text());

    app.kill("SIGTERM");
    expect(await closed).toEqual([0, null]);

    const received = envelopes.join("\n");
    expect(received).not.toMatch(/private-bound-value|private-query-string|private-cookie/);
    const items = envelopes.flatMap((envelope) => {
      const [, ...lines] = envelope.trimEnd().split("\n");
      return lines
        .filter((_, index) => index % 2 === 0)
        .map((line, index) => ({
          type: JSON.parse(line).type as string,
          data: JSON.parse(lines[index * 2 + 1] ?? "{}"),
        }));
    });
    const errors = items.filter(({ type }) => type === "event");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.data.tags.request_id).toBe(requestId);
    expect(items.some(({ type }) => type === "log")).toBe(true);
    const transactions = items.filter(({ type }) => type === "transaction").map(({ data }) => data);
    expect(transactions).toHaveLength(3);
    expect(transactions.map((tx) => tx.transaction)).toEqual(Array(3).fill("POST /api/v1/monitoring-test/:mode"));
    const read = transactions.find((tx) => tx.contexts.trace.status === "ok");
    expect(read?.spans).toEqual(
      expect.arrayContaining([expect.objectContaining({ op: "db", description: "PostgreSQL query" })]),
    );
    const failure = transactions.find((tx) => tx.contexts.trace.status === "internal_error");
    expect(failure?.spans).toEqual(
      expect.arrayContaining([expect.objectContaining({ op: "db", status: "internal_error" })]),
    );
    expect(errors[0]?.data.contexts.trace.trace_id).toBe(failure?.contexts.trace.trace_id);
  } finally {
    if (app.exitCode === null && app.signalCode === null) app.kill("SIGKILL");
    await closed.catch(() => undefined);
    collector.closeAllConnections();
    await new Promise<void>((resolve) => collector.close(() => resolve()));
    await rm(dataDir, { recursive: true, force: true });
    await reset().finally(() => database.end());
  }
});
