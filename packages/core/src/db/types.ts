import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema/index.ts";

export type Schema = typeof schema;

/**
 * The database handle core code receives. It is Drizzle's driver-independent
 * Postgres type, so node-postgres (server), PGlite (tests, browser demo) and
 * any future driver all satisfy it.
 */
export type Db = PgDatabase<PgQueryResultHKT, Schema>;
