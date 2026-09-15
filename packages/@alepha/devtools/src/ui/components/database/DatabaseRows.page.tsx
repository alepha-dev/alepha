import { useAlepha, useInject, useStore } from "alepha/react";
import { NestedView, useRouter, useRouterState } from "alepha/react/router";
import { HttpClient } from "alepha/server";
import { Table2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import type { AppRouter } from "../../AppRouter.tsx";
import { devRowCountsAtom } from "../../atoms/devRowCountsAtom.ts";
import { useMetadata } from "../../hooks/useMetadata.ts";
import { DevEmpty } from "../shared/DevEmpty.tsx";
import { DevError } from "../shared/DevError.tsx";

/**
 * The Rows layout: the table rail, and the open table beside it.
 *
 * A layout rather than part of the table page (#Q2351). Since #Q2349 a page
 * remounts when its params change, and this layer has none, so the rail's
 * filter, its scroll and its counts outlive every table switch and every row
 * opened under it. The table page renders into the `NestedView`.
 */
const DatabaseRowsPage = () => {
  const meta = useMetadata();
  const alepha = useAlepha();
  const http = useInject(HttpClient);
  const router = useRouter<AppRouter>();
  const state = useRouterState();
  const [tableFilter, setTableFilter] = useState("");
  const [counts] = useStore(devRowCountsAtom);

  const entities = useMemo<any[]>(() => meta.data?.entities ?? [], [meta.data]);
  const table =
    typeof state.params.table === "string" ? state.params.table : "";

  /**
   * Row counts for the rail, fetched with `size=1` so the rail can show them
   * without pulling any rows. Once per devtools session: a count already in
   * the atom is not asked for again, and the open table's is kept current by
   * the grid.
   */
  useEffect(() => {
    let cancelled = false;
    const missing = entities.filter((e) => counts[e.name] === undefined);
    void (async () => {
      for (const e of missing) {
        if (cancelled) return;
        try {
          const res = await http.fetch(
            `/__devtools/api/db/${encodeURIComponent(e.name)}/records?page=0&size=1`,
          );
          const n = (res.data as any)?.page?.totalElements ?? 0;
          if (cancelled) return;
          alepha.store.set(devRowCountsAtom, {
            ...alepha.store.get(devRowCountsAtom),
            [e.name]: n,
          });
        } catch {
          // A table that can't be counted simply shows no badge.
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // `counts` is read for what is missing when the entity list arrives, and
    // deliberately not a dependency: each count this effect writes would
    // cancel it and start the pass again.
  }, [entities, http, alepha]);

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
              onClick={() =>
                // By name, so the grid's page, sort and search are left
                // behind: they describe the table being left.
                void router.push("rowsTable", { params: { table: e.name } })
              }
            >
              <Table2 size={11} style={{ color: "var(--dt-get)" }} />
              <span className="dt-mono">{e.name}</span>
              <span className="dt-nav-count">{counts[e.name] ?? ""}</span>
            </button>
          ))}
        </div>
      </div>

      <NestedView>
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minWidth: 0,
            minHeight: 0,
          }}
        >
          <DevEmpty title="Select a table" hint="Pick a table to browse rows" />
        </div>
      </NestedView>
    </div>
  );
};

export default DatabaseRowsPage;
