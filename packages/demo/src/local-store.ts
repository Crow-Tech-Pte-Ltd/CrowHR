import { assertValidFileKey, type FileStore, type Mailer } from "@crowhr/core";
import type { OutboxMessage } from "./protocol.ts";

/**
 * Demo-only storage that lives in the visitor's own PGlite database, outside core's schema (the
 * `demo_` tables are created here, not by a migration): a key/value table (cookie jar, demo clock
 * anchor, secret key), uploaded files, and the "Demo outbox" that stands in for SMTP. Everything
 * sits in the same IndexedDB database, so a reset wipes it all at once.
 */
export interface SqlClient {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<unknown>;
}

export async function ensureLocalTables(sql: SqlClient) {
  await sql.exec(`
    create table if not exists demo_kv (key text primary key, value jsonb not null);
    create table if not exists demo_files (
      key text primary key, content_type text not null, size integer not null, data bytea not null
    );
    create table if not exists demo_outbox (
      id serial primary key, sent_at timestamptz not null, to_addr text not null,
      subject text not null, body_text text not null, body_html text
    );
  `);
}

export function createKv(sql: SqlClient) {
  return {
    async get<T>(key: string): Promise<T | null> {
      const { rows } = await sql.query<{ value: T }>("select value from demo_kv where key = $1", [key]);
      return rows[0]?.value ?? null;
    },
    async set(key: string, value: unknown) {
      await sql.query(
        "insert into demo_kv (key, value) values ($1, $2::jsonb) on conflict (key) do update set value = excluded.value",
        [key, JSON.stringify(value)],
      );
    },
  };
}
export type Kv = ReturnType<typeof createKv>;

/** FileStore on the demo database (receipts, payslip PDFs survive a reload, and go on reset). */
export function createSqlFileStore(sql: SqlClient): FileStore {
  return {
    async put(key, data, meta) {
      assertValidFileKey(key);
      await sql.query(
        `insert into demo_files (key, content_type, size, data) values ($1, $2, $3, $4)
         on conflict (key) do update set content_type = excluded.content_type, size = excluded.size, data = excluded.data`,
        [key, meta.contentType, data.byteLength, data],
      );
      return { key, contentType: meta.contentType, size: data.byteLength };
    },
    async get(key) {
      assertValidFileKey(key);
      const { rows } = await sql.query<{ content_type: string; size: number; data: Uint8Array }>(
        "select content_type, size, data from demo_files where key = $1",
        [key],
      );
      const row = rows[0];
      return row ? { key, contentType: row.content_type, size: row.size, data: new Uint8Array(row.data) } : null;
    },
    async delete(key) {
      assertValidFileKey(key);
      await sql.query("delete from demo_files where key = $1", [key]);
    },
  };
}

/**
 * The demo's Mailer: nothing is sent anywhere. Messages land in `demo_outbox`, which the page
 * shows as the "Demo outbox", so invitation and password-reset links still work.
 */
export function createOutboxMailer(
  sql: SqlClient,
  options: { now: () => Date; onSent?: () => void },
): Mailer & { list(): Promise<OutboxMessage[]>; count(): Promise<number> } {
  return {
    async send(message) {
      await sql.query(
        "insert into demo_outbox (sent_at, to_addr, subject, body_text, body_html) values ($1, $2, $3, $4, $5)",
        [options.now().toISOString(), message.to, message.subject, message.text, message.html ?? null],
      );
      options.onSent?.();
    },
    async list() {
      const { rows } = await sql.query<{
        id: number;
        sent_at: Date | string;
        to_addr: string;
        subject: string;
        body_text: string;
        body_html: string | null;
      }>("select * from demo_outbox order by id desc limit 200");
      return rows.map((r) => ({
        id: r.id,
        sentAt: new Date(r.sent_at).toISOString(),
        to: r.to_addr,
        subject: r.subject,
        text: r.body_text,
        html: r.body_html,
      }));
    },
    async count() {
      const { rows } = await sql.query<{ n: number }>("select count(*)::int as n from demo_outbox");
      return rows[0]?.n ?? 0;
    },
  };
}
