import { Control } from "@alepha/ui/components/control/control";
import { z } from "alepha";
import { useForm } from "alepha/react/form";

import { DT_TRIGGER } from "../shared/dtTrigger.ts";
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

  // Both forms are declared unconditionally: the module picker only renders in
  // the service view, and a hook behind that condition would change hook order
  // the moment the reader switches tabs.
  //
  // `keepDirty: false` on both, because the parent owns the value: these are
  // props, and a kept "edit" would let the trigger disagree with the graph it
  // is filtering.
  const moduleForm = useForm({
    schema: z.object({ module: z.text() }),
    initialValues: { module: props.filters.module },
    keepDirty: false,
    handler: async () => {},
    onChange: (_key, next) =>
      props.onFiltersChange({
        ...props.filters,
        module: (next as string) || "all",
      }),
  });

  const layoutForm = useForm({
    schema: z.object({ layout: z.text() }),
    initialValues: { layout: props.layout },
    keepDirty: false,
    handler: async () => {},
    onChange: (_key, next) => props.onLayoutChange(next as LayoutType),
  });

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
        // Width on the wrapper, never on the trigger — see `DT_TRIGGER`.
        <div style={{ width: 160 }}>
          <Control
            input={moduleForm.input.module}
            label=""
            inputProps={{ "aria-label": "Filter by module" }}
            triggerClassName={DT_TRIGGER}
            items={[
              { value: "all", label: "All modules" },
              ...props.modules.map((m) => ({ value: m, label: m })),
            ]}
          />
        </div>
      )}

      <div style={{ width: 130 }}>
        <Control
          input={layoutForm.input.layout}
          label=""
          inputProps={{ "aria-label": "Graph layout" }}
          triggerClassName={DT_TRIGGER}
          items={LAYOUTS.map((l) => ({ value: l.value, label: l.label }))}
        />
      </div>

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
