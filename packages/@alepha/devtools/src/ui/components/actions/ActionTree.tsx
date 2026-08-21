import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";

import type { DevActionMetadata } from "../../../schemas/DevActionMetadata.ts";
import { METHOD_COLOR, shortMethod } from "../shared/methodColor.ts";

export const actionKey = (action: DevActionMetadata): string =>
  `${action.method}:${action.fullPath}`;

export interface ActionTreeProps {
  actions: DevActionMetadata[];
  selected: string;
  onSelect: (key: string) => void;
}

/**
 * The action rail, grouped by `$action` group.
 *
 * Groups collapse by default: a real application has hundreds of actions
 * across dozens of controllers (Lore ships 204 across 27), so an
 * expanded-by-default tree opens as an unusable wall. Typing a filter expands
 * whatever matches.
 */
export const ActionTree = (props: ActionTreeProps) => {
  const [filter, setFilter] = useState("");
  const [manuallyOpen, setManuallyOpen] = useState<Set<string>>(new Set());

  const groups = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const map = new Map<string, DevActionMetadata[]>();

    for (const action of props.actions) {
      if (
        q &&
        !action.name.toLowerCase().includes(q) &&
        !action.fullPath.toLowerCase().includes(q)
      ) {
        continue;
      }
      const group = action.group || "default";
      if (!map.has(group)) map.set(group, []);
      map.get(group)!.push(action);
    }

    return Array.from(map.entries())
      .map(([name, items]) => ({
        name,
        items: items.sort((a, b) => a.name.localeCompare(b.name)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [props.actions, filter]);

  const filtering = filter.trim().length > 0;

  return (
    <div className="dt-rail">
      <div className="dt-rail-search">
        <input
          className="dt-input"
          placeholder="Filter actions…"
          value={filter}
          onChange={(e) => setFilter(e.currentTarget.value)}
        />
      </div>

      <div className="dt-rail-body">
        {groups.length === 0 && (
          <div
            style={{
              padding: 16,
              fontSize: 11,
              color: "var(--dt-fg-faint)",
              textAlign: "center",
            }}
          >
            No actions match “{filter}”
          </div>
        )}

        {groups.map((group) => {
          const open = filtering || manuallyOpen.has(group.name);
          return (
            <div key={group.name}>
              <button
                type="button"
                className="dt-group-row"
                onClick={() =>
                  setManuallyOpen((prev) => {
                    const next = new Set(prev);
                    if (next.has(group.name)) next.delete(group.name);
                    else next.add(group.name);
                    return next;
                  })
                }
              >
                <span
                  style={{ width: 12, flex: "none", display: "flex" }}
                  aria-hidden
                >
                  {open ? (
                    <ChevronDown size={11} />
                  ) : (
                    <ChevronRight size={11} />
                  )}
                </span>
                <span
                  className="dt-mono"
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                  title={group.name}
                >
                  {group.name}
                </span>
                <span className="dt-nav-count">{group.items.length}</span>
              </button>

              {open &&
                group.items.map((action) => {
                  const key = actionKey(action);
                  return (
                    <button
                      key={key}
                      type="button"
                      className="dt-leaf"
                      data-active={props.selected === key || undefined}
                      onClick={() => props.onSelect(key)}
                    >
                      <span
                        className="dt-method"
                        style={{
                          color:
                            METHOD_COLOR[action.method.toUpperCase()] ??
                            "var(--dt-fg-faint)",
                        }}
                      >
                        {shortMethod(action.method)}
                      </span>
                      <span className="dt-mono">{action.name}</span>
                    </button>
                  );
                })}
            </div>
          );
        })}
      </div>
    </div>
  );
};
