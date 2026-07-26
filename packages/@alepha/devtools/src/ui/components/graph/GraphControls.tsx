import type { GraphFilters, LayoutType, ViewMode } from "./types.ts";

interface GraphControlsProps {
  filters: GraphFilters;
  onFiltersChange: (filters: GraphFilters) => void;
  layout: LayoutType;
  onLayoutChange: (layout: LayoutType) => void;
  modules: string[];
  nodeCount: number;
  edgeCount: number;
}

const LAYOUTS: Array<{ value: LayoutType; label: string }> = [
  { value: "dagre", label: "Hierarchical" },
  { value: "circular", label: "Circular" },
  { value: "force", label: "Force" },
];

/**
 * The graph's toolbar: what to draw, and how.
 *
 * Named tabs rather than icon buttons — "Modules" and "Services" are the two
 * graphs this screen can draw, and an unlabelled cube versus an unlabelled
 * stack-of-cubes made you click one to find out which was which.
 */
export const GraphControls = (props: GraphControlsProps) => {
  const isModuleView = props.filters.viewMode === "modules";

  const setView = (viewMode: ViewMode) =>
    props.onFiltersChange({ ...props.filters, viewMode });

  return (
    <div className="dt-toolbar">
      <span className="dt-seg">
        <button
          type="button"
          className="dt-seg-item"
          style={{ textTransform: "none", letterSpacing: 0, fontSize: 11 }}
          data-on={isModuleView || undefined}
          onClick={() => setView("modules")}
        >
          Modules
        </button>
        <button
          type="button"
          className="dt-seg-item"
          style={{ textTransform: "none", letterSpacing: 0, fontSize: 11 }}
          data-on={!isModuleView || undefined}
          onClick={() => setView("providers")}
        >
          Services
        </button>
      </span>

      <button
        type="button"
        className="dt-btn"
        data-on={!props.filters.hideFramework || undefined}
        onClick={() =>
          props.onFiltersChange({
            ...props.filters,
            hideFramework: !props.filters.hideFramework,
          })
        }
        title="Include the framework's own modules, not just the application's"
      >
        Framework modules
      </button>

      <input
        className="dt-input"
        style={{ width: 180 }}
        placeholder={isModuleView ? "Find module…" : "Find service…"}
        value={props.filters.search}
        onChange={(e) =>
          props.onFiltersChange({
            ...props.filters,
            search: e.currentTarget.value,
          })
        }
      />

      {!isModuleView && (
        <select
          className="dt-input"
          style={{ width: 160 }}
          value={props.filters.module}
          onChange={(e) =>
            props.onFiltersChange({
              ...props.filters,
              module: e.currentTarget.value || "all",
            })
          }
        >
          <option value="all">All modules</option>
          {props.modules.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      )}

      <select
        className="dt-input"
        style={{ width: 130 }}
        value={props.layout}
        onChange={(e) =>
          props.onLayoutChange(e.currentTarget.value as LayoutType)
        }
      >
        {LAYOUTS.map((l) => (
          <option key={l.value} value={l.value}>
            {l.label}
          </option>
        ))}
      </select>

      <span
        style={{
          marginLeft: "auto",
          fontSize: 10,
          color: "var(--dt-fg-faint)",
        }}
      >
        {props.nodeCount} {isModuleView ? "modules" : "services"} ·{" "}
        {props.edgeCount} edges
      </span>
    </div>
  );
};
