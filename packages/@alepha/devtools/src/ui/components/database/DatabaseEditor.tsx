import { useDialog } from "@alepha/ui/components/use-dialog/use-dialog";
import { z } from "alepha";
import { useInject } from "alepha/react";
import { useQueryParams, useRouter, useRouterState } from "alepha/react/router";
import { HttpClient } from "alepha/server";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  RefreshCw,
  Search,
  Table2,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { useMetadata } from "../../hooks/useMetadata.ts";
import { DevEmpty } from "../shared/DevEmpty.tsx";
import { DevError } from "../shared/DevError.tsx";
import { toText } from "../shared/toText.ts";
import { RecordForm } from "./RecordForm.tsx";
import { RowCell } from "./RowCell.tsx";

const querySchema = z.object({
  page: z.text().optional(),
  size: z.text().optional(),
  sort: z.text().optional(),
  q: z.text().optional(),
});

const parsePath = (pathname: string) => {
  const prefix = "/rows/";
  if (!pathname.startsWith(prefix)) return { table: "", recordId: "" };
  const rest = pathname.slice(prefix.length);
  const slash = rest.indexOf("/");
  if (slash === -1) return { table: decodeURIComponent(rest), recordId: "" };
  return {
    table: decodeURIComponent(rest.slice(0, slash)),
    recordId: decodeURIComponent(rest.slice(slash + 1)),
  };
};

export interface DatabaseEditorProps {
  entities: any[];
}

export const DatabaseEditor = (props: DatabaseEditorProps) => {
  const entities = props.entities;
  const http = useInject(HttpClient);
  const router = useRouter();
  const state = useRouterState();
  const dialog = useDialog();
  const meta = useMetadata();

  const [params, setParams] = useQueryParams(querySchema, {
    format: "querystring",
  });
  const [records, setRecords] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tableFilter, setTableFilter] = useState("");
  const [selection, setSelection] = useState<Set<string>>(new Set());
  const [counts, setCounts] = useState<Record<string, number>>({});

  const { table, recordId } = parsePath(state.url.pathname);
  const isNew = recordId === "new";
  const entity = entities.find((e) => e.name === table);
  const columns: any[] = entity?.columns ?? [];
  const pk = columns.find((c) => c.primaryKey)?.name ?? "id";

  const page = Math.max(0, Number(params.page ?? "0") || 0);
  const size = Math.max(1, Number(params.size ?? "50") || 50);
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
      setRecords(data?.content ?? []);
      setTotal(data?.page?.totalElements ?? 0);
      setSelection(new Set());
    } catch (e: any) {
      setError(e?.message ?? "Failed to load rows");
      setRecords([]);
    } finally {
      setLoading(false);
    }
  }, [http, table, page, size, sort]);

  useEffect(() => {
    // An effect that starts an I/O load is the "synchronize with an external
    // system" case the rule exempts; it reports it because the loader flips
    // `loading` before its first await.
    // oxlint-disable-next-line react/set-state-in-effect
    void load();
  }, [load]);

  /**
   * Row counts for the rail. Fetched once per table with `size=1` so the rail
   * can show what the mockup shows without pulling every row.
   */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const e of entities) {
        if (cancelled || counts[e.name] !== undefined) continue;
        try {
          const res = await http.fetch(
            `/__devtools/api/db/${encodeURIComponent(e.name)}/records?page=0&size=1`,
          );
          const n = (res.data as any)?.page?.totalElements ?? 0;
          if (!cancelled) setCounts((prev) => ({ ...prev, [e.name]: n }));
        } catch {
          // A table that can't be counted simply shows no badge.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [entities, http]);

  const selectedRecord = useMemo(() => {
    if (!recordId || isNew) return null;
    return records.find((r) => String(r[pk]) === recordId) ?? null;
  }, [records, recordId, isNew, pk]);

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

  const write = async (
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
        await router.push(`/rows/${encodeURIComponent(table)}`);
      }
      await load();
      return null;
    } catch (e: any) {
      return e?.message ?? "Save failed";
    }
  };

  const removeIds = async (ids: string[]) => {
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
      await router.push(`/rows/${encodeURIComponent(table)}`);
      await load();
    } catch (e: any) {
      setError(e?.message ?? "Delete failed");
    }
  };

  const visibleTables = useMemo(() => {
    const q = tableFilter.trim().toLowerCase();
    const list = q
      ? entities.filter((e) => e.name.toLowerCase().includes(q))
      : entities;
    return [...list].sort((a, b) => a.name.localeCompare(b.name));
  }, [entities, tableFilter]);

  if (meta.error) {
    return (
      <DevError what="tables" message={meta.error} onRetry={meta.reload} />
    );
  }

  if (!meta.loading && entities.length === 0) {
    return (
      <DevEmpty
        title="No entities declared"
        hint="Use $entity to declare your data model"
      />
    );
  }

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
      <div className="dt-rail" style={{ width: 210 }}>
        <div className="dt-rail-search">
          <input
            className="dt-input"
            placeholder="Filter tables…"
            value={tableFilter}
            onChange={(e) => setTableFilter(e.currentTarget.value)}
          />
        </div>
        <div className="dt-rail-body">
          {visibleTables.map((e) => (
            <button
              key={e.name}
              type="button"
              className="dt-leaf"
              style={{ paddingLeft: 10 }}
              data-active={e.name === table || undefined}
              onClick={() => {
                setParams({});
                void router.push(`/rows/${encodeURIComponent(e.name)}`);
              }}
            >
              <Table2 size={11} style={{ color: "var(--dt-get)" }} />
              <span className="dt-mono">{e.name}</span>
              <span className="dt-nav-count">{counts[e.name] ?? ""}</span>
            </button>
          ))}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minWidth: 0,
          minHeight: 0,
        }}
      >
        {!table ? (
          <DevEmpty title="Select a table" hint="Pick a table to browse rows" />
        ) : (
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
                onClick={() =>
                  router.push(`/rows/${encodeURIComponent(table)}/new`)
                }
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
                    search
                      ? `Nothing matching “${search}”`
                      : `${table} is empty`
                  }
                  action={{
                    label: "Create the first row",
                    onClick: () =>
                      router.push(`/rows/${encodeURIComponent(table)}/new`),
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
                          onClick={() =>
                            router.push(
                              `/rows/${encodeURIComponent(table)}/${encodeURIComponent(id)}`,
                            )
                          }
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
                                  router.push(
                                    `/rows/${encodeURIComponent(ent)}/${encodeURIComponent(fid)}`,
                                  )
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
              <select
                className="dt-input"
                style={{ width: 90 }}
                value={String(size)}
                onChange={(e) =>
                  setParams({
                    ...params,
                    page: "0",
                    size: e.currentTarget.value,
                  })
                }
              >
                {[10, 25, 50, 100].map((n) => (
                  <option key={n} value={String(n)}>
                    {n} / page
                  </option>
                ))}
              </select>
              <span style={{ marginLeft: "auto" }} />
              <span
                className="dt-mono"
                style={{ fontSize: 10, color: "var(--dt-fg-faint)" }}
              >
                {total} rows
              </span>
            </div>
          </>
        )}
      </div>

      {(selectedRecord || isNew) && entity && (
        <RecordForm
          entity={entity}
          record={selectedRecord}
          isNew={isNew}
          pkColumn={pk}
          onSave={(values) =>
            isNew
              ? write("POST", values)
              : write("PUT", values, String(selectedRecord?.[pk]))
          }
          onDuplicate={async (values) => {
            await write("POST", values);
          }}
          onDelete={() =>
            selectedRecord && removeIds([String(selectedRecord[pk])])
          }
          onClose={() => router.push(`/rows/${encodeURIComponent(table)}`)}
        />
      )}
    </div>
  );
};
