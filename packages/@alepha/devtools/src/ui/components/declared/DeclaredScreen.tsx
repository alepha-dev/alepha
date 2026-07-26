import { z } from "alepha";
import { useQueryParams } from "alepha/react/router";
import type { ReactNode } from "react";
import { useMemo, useState } from "react";
import { useMetadata } from "../../hooks/useMetadata.ts";

const querySchema = z.object({
  selected: z.text().optional(),
});

export interface DeclaredScreenProps<T> {
  /**
   * Every declared item of this kind, in metadata order.
   */
  items: T[];
  /**
   * Stable identity used for selection and the `?selected=` query param.
   */
  keyOf: (item: T) => string;
  /**
   * Row label in the rail.
   */
  labelOf: (item: T) => string;
  /**
   * Optional right-aligned annotation in the rail (a cron expression, a
   * subscriber count — whatever distinguishes items at a glance).
   */
  metaOf?: (item: T) => string | undefined;
  renderDetail: (item: T) => ReactNode;
  /**
   * Shown when the application declares none of this kind. Names the primitive
   * so the empty state teaches rather than just reporting absence.
   */
  emptyHint: string;
  filterPlaceholder: string;
}

/**
 * Rail + detail shell shared by every "declared primitive" screen.
 *
 * Pages, schedulers, topics, caches, buckets and realms differ only in their
 * detail panel — the rail, filtering, selection and URL round-trip are
 * identical, so they live here once.
 */
export const DeclaredScreen = <T,>(props: DeclaredScreenProps<T>) => {
  const meta = useMetadata();
  const [params, setParams] = useQueryParams(querySchema, {
    format: "querystring",
  });
  const [filter, setFilter] = useState("");

  const selected = params.selected ?? "";

  const visible = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return props.items;
    return props.items.filter((item) =>
      props.labelOf(item).toLowerCase().includes(q),
    );
  }, [props.items, props.labelOf, filter]);

  const current = useMemo(
    () => props.items.find((item) => props.keyOf(item) === selected),
    [props.items, props.keyOf, selected],
  );

  if (meta.loading && props.items.length === 0) {
    return (
      <div style={centered}>
        <span style={{ color: "var(--dt-fg-faint)" }}>Loading metadata…</span>
      </div>
    );
  }

  if (props.items.length === 0) {
    return (
      <div style={{ ...centered, flexDirection: "column", gap: 6 }}>
        <span style={{ color: "var(--dt-fg-dim)", fontSize: 13 }}>
          Nothing declared
        </span>
        <span
          className="dt-mono"
          style={{ color: "var(--dt-fg-faint)", fontSize: 11 }}
        >
          {props.emptyHint}
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flex: 1, minWidth: 0 }}>
      <div className="dt-rail">
        <div className="dt-rail-search">
          <input
            className="dt-input"
            placeholder={props.filterPlaceholder}
            value={filter}
            onChange={(e) => setFilter(e.currentTarget.value)}
          />
        </div>
        <div className="dt-rail-body">
          {visible.map((item) => {
            const key = props.keyOf(item);
            const annotation = props.metaOf?.(item);
            return (
              <button
                key={key}
                type="button"
                className="dt-leaf"
                style={{ paddingLeft: 12 }}
                data-active={key === selected || undefined}
                onClick={() => setParams({ selected: key })}
              >
                <span className="dt-mono">{props.labelOf(item)}</span>
                {annotation && (
                  <span className="dt-nav-count">{annotation}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      <div className="dt-detail">
        {current ? (
          props.renderDetail(current)
        ) : (
          <div style={centered}>
            <span style={{ color: "var(--dt-fg-faint)", fontSize: 12 }}>
              Select an item from the rail
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

const centered: React.CSSProperties = {
  flex: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  height: "100%",
  fontSize: 12,
};
