import {
  type ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  type Row,
  type SortingState,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import * as React from "react";
import { cn } from "../lib/cn.ts";
import { Skeleton } from "./skeleton.tsx";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table.tsx";

declare module "@tanstack/react-table" {
  interface ColumnMeta<TData, TValue> {
    /** Right-align and render in tabular mono (money, counts, dates). */
    numeric?: boolean;
    headerClassName?: string;
    cellClassName?: string;
  }
}

export interface DataTableProps<TData> {
  columns: ColumnDef<TData, unknown>[];
  data: TData[];
  getRowId: (row: TData) => string;
  /** Accessible name for the table. */
  label: string;
  loading?: boolean;
  /** Rendered in place of rows when `data` is empty and not loading. */
  empty?: React.ReactNode;
  onRowActivate?: (row: Row<TData>) => void;
  initialSorting?: SortingState;
  className?: string;
}

/**
 * TanStack Table v8 with Crow HR defaults: sortable headers (aria-sort), dense
 * rows, skeleton loading rows, empty state, and keyboard navigation —
 * ArrowUp/ArrowDown move between rows, Enter activates.
 */
export function DataTable<TData>({
  columns,
  data,
  getRowId,
  label,
  loading = false,
  empty,
  onRowActivate,
  initialSorting = [],
  className,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = React.useState<SortingState>(initialSorting);
  const table = useReactTable({
    data,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    getRowId: (row) => getRowId(row),
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });
  const bodyRef = React.useRef<HTMLTableSectionElement>(null);

  const onKeyDown = (event: React.KeyboardEvent<HTMLTableRowElement>, row: Row<TData>) => {
    if (event.key === "Enter" && onRowActivate) {
      event.preventDefault();
      onRowActivate(row);
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();
    const rows = Array.from(bodyRef.current?.querySelectorAll<HTMLTableRowElement>("tr[data-row]") ?? []);
    const index = rows.indexOf(event.currentTarget);
    rows[event.key === "ArrowDown" ? index + 1 : index - 1]?.focus();
  };

  const colCount = table.getVisibleLeafColumns().length;
  const rows = table.getRowModel().rows;

  return (
    <Table aria-label={label} aria-busy={loading || undefined} containerClassName={className}>
      <TableHeader>
        {table.getHeaderGroups().map((group) => (
          <TableRow key={group.id} className="hover:bg-transparent">
            {group.headers.map((header) => {
              const meta = header.column.columnDef.meta;
              const sorted = header.column.getIsSorted();
              const canSort = header.column.getCanSort();
              return (
                <TableHead
                  key={header.id}
                  numeric={meta?.numeric}
                  className={meta?.headerClassName}
                  aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}
                >
                  {header.isPlaceholder ? null : canSort ? (
                    <button
                      type="button"
                      onClick={header.column.getToggleSortingHandler()}
                      className={cn(
                        "focus-ring -mx-1 inline-flex items-center gap-1 rounded-sm px-1 uppercase hover:text-ink",
                        meta?.numeric && "flex-row-reverse",
                        sorted && "text-ink",
                      )}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      {sorted === "asc" ? (
                        <ArrowUp className="size-3" />
                      ) : sorted === "desc" ? (
                        <ArrowDown className="size-3" />
                      ) : (
                        <ChevronsUpDown className="size-3 opacity-40" />
                      )}
                    </button>
                  ) : (
                    flexRender(header.column.columnDef.header, header.getContext())
                  )}
                </TableHead>
              );
            })}
          </TableRow>
        ))}
      </TableHeader>
      <TableBody ref={bodyRef}>
        {loading ? (
          Array.from({ length: 5 }, (_, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder rows.
            <TableRow key={i} className="hover:bg-transparent">
              {Array.from({ length: colCount }, (_, j) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder cells.
                <TableCell key={j}>
                  <Skeleton className="h-3.5 w-full max-w-[10rem]" />
                </TableCell>
              ))}
            </TableRow>
          ))
        ) : rows.length === 0 ? (
          <TableRow className="hover:bg-transparent">
            <TableCell colSpan={colCount} className="p-0">
              {empty ?? <p className="px-3 py-8 text-center text-primary-200">Nothing to show.</p>}
            </TableCell>
          </TableRow>
        ) : (
          rows.map((row) => (
            <TableRow
              key={row.id}
              data-row
              tabIndex={0}
              onKeyDown={(e) => onKeyDown(e, row)}
              onClick={onRowActivate ? () => onRowActivate(row) : undefined}
              className={cn(onRowActivate && "cursor-pointer")}
            >
              {row.getVisibleCells().map((cell) => {
                const meta = cell.column.columnDef.meta;
                return (
                  <TableCell key={cell.id} numeric={meta?.numeric} className={meta?.cellClassName}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                );
              })}
            </TableRow>
          ))
        )}
      </TableBody>
    </Table>
  );
}

export type { ColumnDef, Row, SortingState } from "@tanstack/react-table";
