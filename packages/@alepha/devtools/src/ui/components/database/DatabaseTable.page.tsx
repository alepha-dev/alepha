import { useDialog } from "@alepha/ui";
import { Control } from "@alepha/ui/form";
import { z } from "alepha";
import { useAlepha, useInject } from "alepha/react";
import { useForm } from "alepha/react/form";
import {
  NestedView,
  useQueryParams,
  useRouter,
  useRouterState,
} from "alepha/react/router";
import { HttpClient } from "alepha/server";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { AppRouter } from "../../AppRouter.tsx";
import { devRowCountsAtom } from "../../atoms/devRowCountsAtom.ts";
import { useMetadata } from "../../hooks/useMetadata.ts";
import { DevEmpty } from "../shared/DevEmpty.tsx";
import { DT_TRIGGER } from "../shared/dtTrigger.ts";
import { toText } from "../shared/toText.ts";
import {
  DatabaseTableContext,
  type DatabaseTableContextValue,
} from "./DatabaseTableContext.ts";
import { RowCell } from "./RowCell.tsx";

const querySchema = z.object({
  page: z.text().optional(),
  size: z.text().optional(),
  sort: z.text().optional(),
  q: z.text().optional(),
});

export interface DatabaseTablePageProps {
  /**
   * Which table is open, from the route's own decoded params.
   */
  table: string;
}

/**
 * One table's grid, under the Rows layout's rail.
 *
 * The record a row opens is a CHILD route, rendered into this page's
 * `NestedView` (#Q2351), so opening and closing a record keeps this page
 * mounted: its rows, its page and its selection stay as they were. The child
 * reads the grid through {@link DatabaseTableContext}. A different table is a
 * different path, and remounts this page, as it should.
 */
const DatabaseTablePage = (props: DatabaseTablePageProps) => {
  const http = useInject(HttpClient);
  const alepha = useAlepha();
  const router = useRouter<AppRouter>();
  const routerState = useRouterState();
  const dialog = useDialog();
  const meta = useMetadata();
  const entities: any[] = meta.data?.entities ?? [];

  const [params, setParams] = useQueryParams(querySchema, {
    format: "querystring",
  });
  const [records, setRecords] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Set<string>>(new Set());

  const { table } = props;
  // Only to mark the open row: the record itself is the child route's.
  const recordId =
    typeof routerState.params.id === "string" ? routerState.params.id : "";
  const entity = entities.find((e) => e.name === table);
  const columns: any[] = entity?.columns ?? [];
  const pk = columns.find((c) => c.primaryKey)?.name ?? "id";

  const page = Math.max(0, Number(params.page ?? "0") || 0);
  const size = Math.max(1, Number(params.size ?? "50") || 50);

  // The page size lives in the URL, so the picker's own value is derived and
  // `keepDirty: false` is what keeps the trigger honest: a Back button or a
  // shared link moves `size` without touching the picker, and a kept "edit"
  // would leave the trigger naming a page size the table is not using.
  const sizeForm = useForm({
    schema: z.object({ size: z.number() }),
    initialValues: { size },
    keepDirty: false,
    handler: async () => {},
    onChange: (_key, next) =>
      setParams({ ...params, page: "0", size: String(next as number) }),
  });
  const sort = params.sort ?? "";
  const search = (params.q ?? "").trim().toLowerCase();

  const load = useCallback(async () => {
    if (!table) return;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({
        page: String(page),
        size: String(size),
      });
      if (sort) qs.set("sort", sort);
      const res = await http.fetch(
        `/__devtools/api/db/${encodeURIComponent(table)}/records?${qs}`,
      );
      const data = res.data as any;
      const totalElements = data?.page?.totalElements ?? 0;
      setRecords(data?.content ?? []);
      setTotal(totalElements);
      setSelection(new Set());
      // The rail's count for this table, kept current from what the grid
      // just read rather than by counting every table again.
      alepha.store.set(devRowCountsAtom, {
        ...alepha.store.get(devRowCountsAtom),
        [table]: totalElements,
      });
    } catch (e: any) {
      setError(e?.message ?? "Failed to load rows");
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [http, alepha, table, page, size, sort]);

  useEffect(() => {
    // An effect that starts an I/O load is the "synchronize with an external
    // system" case the rule exempts; it reports it because the loader flips
    // `loading` before its first await.
    // oxlint-disable-next-line react/set-state-in-effect
    void load();
  }, [load]);

  /**
   * Client-side row search over the loaded page — the records endpoint takes
   * no filter, so this narrows what you can see rather than pretending to
   * query the table.
   */
  const visibleRows = useMemo(() => {
    if (!search) return records;
    return records.filter((r) =>
      Object.values(r).some((v) => toText(v).toLowerCase().includes(search)),
    );
  }, [records, search]);

  const write = useCallback(
    async (
      method: "POST" | "PUT",
      values: any,
      id?: string,
    ): Promise<string | null> => {
      try {
        const url =
          method === "POST"
            ? `/__devtools/api/db/${encodeURIComponent(table)}/records`
            : `/__devtools/api/db/${encodeURIComponent(table)}/records/${encodeURIComponent(id!)}`;
        await http.fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(values),
        });
        if (method === "POST") {
          await router.push("rowsTable", {
            params: { table },
            query: router.query,
          });
        }
        await load();
        return null;
      } catch (e: any) {
        return e?.message ?? "Save failed";
      }
    },
    [http, router, table, load],
  );

  const removeIds = useCallback(
    async (ids: string[]) => {
      const ok = await dialog.confirm({
        title: ids.length > 1 ? `Delete ${ids.length} rows?` : "Delete row?",
        description:
          ids.length > 1
            ? `${ids.length} rows from ${table} — this cannot be undone.`
            : `${pk}: ${ids[0]} — this cannot be undone.`,
        confirmLabel: "Delete",
        destructive: true,
      });
      if (!ok) return;
      try {
        for (const id of ids) {
          await http.fetch(
            `/__devtools/api/db/${encodeURIComponent(table)}/records/${encodeURIComponent(id)}`,
            { method: "DELETE" },
          );
        }
        await router.push("rowsTable", {
          params: { table },
          query: router.query,
        });
        await load();
      } catch (e: any) {
        setError(e?.message ?? "Delete failed");
      }
    },
    [dialog, http, router, table, pk, load],
  );

  /**
   * Opens a record beside the grid, keeping the grid's page, size, sort and
   * search: a push by route name drops the query otherwise, and a changed
   * page would reload the rows this page exists to keep.
   */
  const openRecord = (id: string) =>
    router.push("rowsRecord", {
      params: { table, id },
      query: router.query,
    });

  const context = useMemo<DatabaseTableContextValue>(
    () => ({ entity, pk, records, write, removeIds }),
    [entity, pk, records, write, removeIds],
  );

  const lastPage = Math.max(0, Math.ceil(total / size) - 1);
  const pageNumbers = Array.from(
    { length: Math.min(5, lastPage + 1) },
    (_, i) => Math.max(0, Math.min(lastPage - 4, page - 2)) + i,
  ).filter((n) => n >= 0 && n <= lastPage);

  const toggleSort = (name: string) => {
    const asc = `${name},asc`;
    setParams({
      ...params,
      page: "0",
      sort: sort === asc ? `${name},desc` : asc,
    });
  };

  return (
    <div style={{ display: "flex", flex: 1, minWidth: 0, minHeight: 0 }}>
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minWidth: 0,
          minHeight: 0,
        }}
      >
        <>
          <div className="dt-toolbar">
            <span className="dt-mono" style={{ fontSize: 12 }}>
              {table}
            </span>
            <span
              className="dt-mono"
              style={{ fontSize: 10, color: "var(--dt-fg-faint)" }}
            >
              {columns.length} cols · {total} rows
            </span>

            <span style={{ position: "relative", display: "flex" }}>
              <Search
                size={11}
                style={{
                  position: "absolute",
                  left: 7,
                  top: 8,
                  color: "var(--dt-fg-faint)",
                }}
              />
              <input
                className="dt-input"
                style={{ width: 180, paddingLeft: 22 }}
                placeholder="Search rows…"
                value={params.q ?? ""}
                onChange={(e) =>
                  setParams({
                    ...params,
                    q: e.currentTarget.value || undefined,
                  })
                }
              />
            </span>

            {sort && (
              <span className="dt-chip">
                {sort}
                <button
                  type="button"
                  style={{
                    border: 0,
                    background: "none",
                    color: "inherit",
                    cursor: "pointer",
                    marginLeft: 4,
                  }}
                  onClick={() => setParams({ ...params, sort: undefined })}
                >
                  ×
                </button>
              </span>
            )}

            <span style={{ marginLeft: "auto" }} />
            <button type="button" className="dt-btn" onClick={load}>
              <RefreshCw size={11} />
            </button>
            <button
              type="button"
              className="dt-btn"
              data-variant="primary"
              onClick={() => openRecord("new")}
            >
              <Plus size={11} /> New
            </button>
          </div>

          {selection.size > 0 && (
            <div
              className="dt-toolbar"
              style={{
                background: "var(--dt-danger-soft)",
                borderBottom:
                  "1px solid color-mix(in srgb, var(--dt-danger) 35%, transparent)",
              }}
            >
              <span style={{ fontSize: 11 }}>
                {selection.size} row{selection.size > 1 ? "s" : ""} selected
              </span>
              <button
                type="button"
                className="dt-btn"
                data-variant="danger"
                onClick={() => removeIds(Array.from(selection))}
              >
                <Trash2 size={11} /> Delete selected
              </button>
            </div>
          )}

          {error && (
            <div
              style={{
                padding: "8px 12px",
                fontSize: 11,
                color: "var(--dt-error)",
                borderBottom: "1px solid var(--dt-border)",
              }}
            >
              {error}
            </div>
          )}

          <div style={{ flex: 1, overflow: "auto", minHeight: 0 }}>
            {loading && records.length === 0 ? (
              <div className="dt-empty">
                <span className="dt-empty-hint">Loading…</span>
              </div>
            ) : visibleRows.length === 0 ? (
              <DevEmpty
                title={search ? "No rows match" : "No rows"}
                hint={
                  search ? `Nothing matching “${search}”` : `${table} is empty`
                }
                action={{
                  label: "Create the first row",
                  onClick: () => openRecord("new"),
                }}
              />
            ) : (
              <table className="dt-table">
                <thead>
                  <tr>
                    <th style={{ width: 28 }}>
                      <input
                        type="checkbox"
                        aria-label="Select all rows"
                        checked={
                          selection.size > 0 &&
                          selection.size === visibleRows.length
                        }
                        onChange={(e) =>
                          setSelection(
                            e.currentTarget.checked
                              ? new Set(visibleRows.map((r) => String(r[pk])))
                              : new Set(),
                          )
                        }
                      />
                    </th>
                    {columns.map((c) => (
                      <th
                        key={c.name}
                        style={{ cursor: "pointer" }}
                        onClick={() => toggleSort(c.name)}
                        title="Sort"
                      >
                        {c.name}
                        {sort.startsWith(`${c.name},`) &&
                          (sort.endsWith("asc") ? " ▲" : " ▼")}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.map((record, i) => {
                    const id = String(record[pk] ?? i);
                    return (
                      <tr
                        key={id}
                        className="dt-row-click"
                        data-active={id === recordId || undefined}
                        onClick={() => openRecord(id)}
                      >
                        <td onClick={(e) => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            aria-label="Select row"
                            checked={selection.has(id)}
                            onChange={(e) => {
                              const next = new Set(selection);
                              if (e.currentTarget.checked) next.add(id);
                              else next.delete(id);
                              setSelection(next);
                            }}
                          />
                        </td>
                        {columns.map((c) => (
                          <td key={c.name}>
                            <RowCell
                              value={record[c.name]}
                              column={c}
                              onFollow={(ent, fid) =>
                                router.push("rowsRecord", {
                                  params: { table: ent, id: fid },
                                })
                              }
                            />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          <div
            className="dt-toolbar"
            style={{
              borderTop: "1px solid var(--dt-border)",
              borderBottom: 0,
            }}
          >
            <button
              type="button"
              className="dt-btn"
              disabled={page <= 0}
              onClick={() => setParams({ ...params, page: String(page - 1) })}
            >
              <ChevronLeft size={11} />
            </button>
            {pageNumbers.map((n) => (
              <button
                key={n}
                type="button"
                className="dt-btn"
                data-on={n === page || undefined}
                onClick={() => setParams({ ...params, page: String(n) })}
              >
                {n + 1}
              </button>
            ))}
            <button
              type="button"
              className="dt-btn"
              disabled={page >= lastPage}
              onClick={() => setParams({ ...params, page: String(page + 1) })}
            >
              <ChevronRight size={11} />
            </button>
            {/* Width on the wrapper, never on the trigger — see
                  `DT_TRIGGER`. */}
            <div style={{ width: 90 }}>
              <Control
                input={sizeForm.input.size}
                label=""
                inputProps={{ "aria-label": "Rows per page" }}
                triggerClassName={DT_TRIGGER}
                items={[10, 25, 50, 100].map((n) => ({
                  value: String(n),
                  label: `${n} / page`,
                }))}
              />
            </div>
            <span style={{ marginLeft: "auto" }} />
            <span
              className="dt-mono"
              style={{ fontSize: 10, color: "var(--dt-fg-faint)" }}
            >
              {total} rows
            </span>
          </div>
        </>
      </div>

      <DatabaseTableContext.Provider value={context}>
        <NestedView />
      </DatabaseTableContext.Provider>
    </div>
  );
};

export default DatabaseTablePage;
