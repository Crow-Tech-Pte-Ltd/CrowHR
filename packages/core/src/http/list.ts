import { asc, desc, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { z } from "zod";

/**
 * List conventions shared by every collection endpoint (docs/api.md "Lists"):
 *
 *   GET /api/v1/<things>?page=2&pageSize=50&sort=-createdAt&q=tan&status=active,invited
 *   → 200 { items: [...], page: 2, pageSize: 50, total: 132 }
 *
 * - `page` is 1-based; `pageSize` defaults to 50, max 200.
 * - `sort` is one field name; prefix `-` for descending. Only declared fields are accepted.
 * - `q` is free-text search, when the endpoint supports it.
 * - Filters are plain query parameters named after the field. Multi-value filters are
 *   comma-separated (`csvEnum`). Date ranges use `<field>From` / `<field>To` (YYYY-MM-DD, inclusive).
 */

export const MAX_PAGE_SIZE = 200;
export const DEFAULT_PAGE_SIZE = 50;

export interface ListQueryOptions<Sort extends string, Filters extends z.ZodRawShape> {
  /** Sortable field names (API names, camelCase). */
  sort: readonly [Sort, ...Sort[]];
  /** Default sort, e.g. `"-createdAt"`. */
  defaultSort: Sort | `-${Sort}`;
  /** Extra filter parameters. */
  filters?: Filters;
  /** Accept `q` free-text search. */
  search?: boolean;
}

/** Builds the query schema for a list endpoint. Use as `request.query`. */
export function listQuery<const Sort extends string, const Filters extends z.ZodRawShape = Record<never, never>>(
  options: ListQueryOptions<Sort, Filters>,
) {
  const sortValues = options.sort.flatMap((s) => [s, `-${s}`]) as [string, ...string[]];
  return z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
    sort: z
      .enum(sortValues as [Sort | `-${Sort}`, ...(Sort | `-${Sort}`)[]], {
        error: `Sort by one of: ${sortValues.join(", ")}. Prefix with - for descending.`,
      })
      // biome-ignore lint/suspicious/noExplicitAny: zod's enum-default typing cannot follow the template literal.
      .default(options.defaultSort as any),
    ...(options.search ? { q: z.string().trim().max(200).optional() } : {}),
    ...(options.filters ?? ({} as Filters)),
  });
}

/** The response envelope for a list endpoint. */
export function pageOf<Item extends z.ZodType>(item: Item) {
  return z.object({
    items: z.array(item),
    page: z.number().int(),
    pageSize: z.number().int(),
    total: z.number().int(),
  });
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
}

/** A comma-separated multi-value filter: `?status=active,invited` → `["active", "invited"]`. */
export function csvEnum<const V extends string>(values: readonly [V, ...V[]]) {
  return z
    .string()
    .transform((s) =>
      s
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.enum(values, { error: `Use one or more of: ${values.join(", ")}, separated by commas.` })).min(1))
    .optional();
}

/** `limit`/`offset` for a parsed list query. */
export function toLimitOffset(q: { page: number; pageSize: number }): { limit: number; offset: number } {
  return { limit: q.pageSize, offset: (q.page - 1) * q.pageSize };
}

/** `"-createdAt"` → `{ field: "createdAt", direction: "desc" }`. */
export function parseSort<Sort extends string>(sort: Sort | `-${Sort}`): { field: Sort; direction: "asc" | "desc" } {
  return sort.startsWith("-")
    ? { field: sort.slice(1) as Sort, direction: "desc" }
    : { field: sort as Sort, direction: "asc" };
}

/**
 * Drizzle `orderBy` for a parsed sort, with a stable tiebreaker (usually the primary key) so
 * pages never overlap or skip rows.
 */
export function orderByFor<Sort extends string>(
  sort: Sort | `-${Sort}`,
  columns: Record<Sort, PgColumn | SQL>,
  tiebreaker: PgColumn,
): SQL[] {
  const { field, direction } = parseSort(sort);
  const column = columns[field];
  return [direction === "asc" ? asc(column) : desc(column), asc(tiebreaker)];
}
