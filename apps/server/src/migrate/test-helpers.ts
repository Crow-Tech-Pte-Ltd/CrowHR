import { copyFile, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { migrationsFolder } from "@crowhr/core/migrations-folder";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { AdvisoryLock } from "./runner.ts";

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}

/**
 * Builds a migrations folder from the first `take` bundled migrations plus `extra` SQL
 * migrations (tag → statements), for upgrade and failure tests.
 */
export async function makeMigrationsFolder(
  options: { take?: number; extra?: Record<string, string[]> } = {},
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "crowhr-migrations-"));
  await mkdir(join(dir, "meta"));
  const journal = JSON.parse(await readFile(join(migrationsFolder, "meta", "_journal.json"), "utf8")) as {
    entries: JournalEntry[];
  };
  const entries = journal.entries.slice(0, options.take ?? journal.entries.length);
  for (const e of entries) await copyFile(join(migrationsFolder, `${e.tag}.sql`), join(dir, `${e.tag}.sql`));
  let when = Math.max(...entries.map((e) => e.when));
  for (const [tag, statements] of Object.entries(options.extra ?? {})) {
    when += 1000;
    await writeFile(join(dir, `${tag}.sql`), statements.join("\n--> statement-breakpoint\n"));
    entries.push({ idx: entries.length, version: "7", when, tag, breakpoints: true });
  }
  await writeFile(join(dir, "meta", "_journal.json"), JSON.stringify({ ...journal, entries }, null, 2));
  return dir;
}

export function freshPglite() {
  const client = new PGlite();
  return { client, db: drizzle({ client }) as never, close: () => client.close() };
}

/** In-process mutex standing in for the Postgres advisory lock (PGlite has one session). */
export function memoryLock(): AdvisoryLock & { holders: number; maxHolders: number } {
  let tail = Promise.resolve();
  let queued = 0;
  const lock = {
    holders: 0,
    maxHolders: 0,
    async acquire(_name: string, { timeoutMs, onWait }: { timeoutMs: number; onWait?: (s: number) => void }) {
      let releaseNext!: () => void;
      const mine = new Promise<void>((r) => {
        releaseNext = r;
      });
      const previous = tail;
      tail = previous.then(() => mine);
      if (queued > 0) onWait?.(0);
      queued += 1;
      const got = await Promise.race([
        previous.then(() => true),
        new Promise<false>((r) => setTimeout(() => r(false), timeoutMs)),
      ]);
      if (!got) {
        queued -= 1;
        releaseNext();
        return null;
      }
      lock.holders += 1;
      lock.maxHolders = Math.max(lock.maxHolders, lock.holders);
      return async () => {
        lock.holders -= 1;
        queued -= 1;
        releaseNext();
      };
    },
  };
  return lock;
}
