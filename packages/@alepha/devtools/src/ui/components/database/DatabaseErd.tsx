import { Control } from "@alepha/ui/components/control/control";
import {
  type Edge,
  type Node,
  ReactFlow,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "@xyflow/react";
import { z } from "alepha";
import { useForm } from "alepha/react/form";

import "@xyflow/react/dist/style.css";
import { Maximize2, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { DevEmpty } from "../shared/DevEmpty.tsx";
import { DT_TRIGGER } from "../shared/dtTrigger.ts";
import { EntityNode } from "./EntityNode.tsx";
import { type ErdLayout, layoutEntities } from "./layoutEntities.ts";
import { SchemaDetail } from "./SchemaDetail.tsx";

const nodeTypes = { entity: EntityNode };

const HEADER_H = 30;
const ROW_H = 17;

export interface DatabaseErdProps {
  entities: any[];
}

interface ErdCanvasProps {
  entities: any[];
  layout: ErdLayout;
  compact: boolean;
  find: string;
  selected: string;
  onSelect: (name: string) => void;
  onCounts: (entities: number, relations: number) => void;
}

const ErdCanvas = (props: ErdCanvasProps) => {
  const { fitView } = useReactFlow();

  const graph = useMemo(() => {
    const q = props.find.trim().toLowerCase();
    const visible = q
      ? props.entities.filter((e) => e.name.toLowerCase().includes(q))
      : props.entities;
    const names = new Set(visible.map((e) => e.name));

    const relations: Array<{ from: string; to: string; column: string }> = [];
    for (const entity of visible) {
      for (const column of entity.columns ?? []) {
        if (column.ref && names.has(column.ref.entity)) {
          relations.push({
            from: entity.name,
            to: column.ref.entity,
            column: column.name,
          });
        }
      }
    }

    // Neighbours of the selection, so everything unrelated can be dimmed.
    const related = new Set<string>();
    if (props.selected) {
      related.add(props.selected);
      for (const r of relations) {
        if (r.from === props.selected) related.add(r.to);
        if (r.to === props.selected) related.add(r.from);
      }
    }

    const boxes = visible.map((entity) => {
      const cols = entity.columns ?? [];
      const rows = props.compact
        ? cols.filter((c: any) => c.primaryKey || c.ref).length + 1
        : cols.length;
      return {
        id: entity.name,
        width: 210,
        height: HEADER_H + rows * ROW_H,
      };
    });

    const positions = layoutEntities(boxes, relations, props.layout);

    const nodes: Node[] = visible.map((entity) => {
      const n = { id: entity.name };
      return {
        id: entity.name,
        type: "entity",
        position: positions[entity.name] ?? { x: 0, y: 0 },
        data: {
          entity,
          compact: props.compact,
          selected: props.selected === n.id,
          dimmed: props.selected ? !related.has(n.id) : false,
        },
      };
    });

    const edges: Edge[] = relations.map((r, i) => {
      const active = related.has(r.from) && related.has(r.to);
      return {
        id: `${r.from}.${r.column}->${r.to}-${i}`,
        source: r.from,
        target: r.to,
        label: r.column,
        animated: active,
        style: {
          stroke: active ? "var(--dt-info)" : "#33333a",
          strokeWidth: active ? 1.6 : 1,
          opacity: props.selected && !active ? 0.25 : 1,
        },
      };
    });

    return { nodes, edges, count: visible.length, relations: relations.length };
  }, [props.entities, props.layout, props.compact, props.find, props.selected]);

  const [nodes, setNodes, onNodesChange] = useNodesState(graph.nodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(graph.edges);

  useEffect(() => {
    setNodes(graph.nodes);
    setEdges(graph.edges);
    props.onCounts(graph.count, graph.relations);
  }, [graph, setNodes, setEdges, props.onCounts]);

  useEffect(() => {
    const id = setTimeout(() => fitView({ padding: 0.15 }), 60);
    return () => clearTimeout(id);
  }, [props.layout, props.compact, props.find, fitView]);

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      onNodesChange={onNodesChange}
      onEdgesChange={onEdgesChange}
      onNodeClick={(_, node) => props.onSelect(node.id)}
      onPaneClick={() => props.onSelect("")}
      nodeTypes={nodeTypes}
      fitView
      fitViewOptions={{ padding: 0.15 }}
      minZoom={0.05}
      maxZoom={2}
      proOptions={{ hideAttribution: true }}
      style={{ background: "var(--dt-bg)" }}
    >
      {/*
       * A bare canvas. The dot grid and the minimap both drew attention
       * without carrying information — the toolbar's Fit button is the
       * navigation affordance, and the tables themselves are what should be
       * legible here.
       */}
    </ReactFlow>
  );
};

export const DatabaseErd = (props: DatabaseErdProps) => {
  const [layout, setLayout] = useState<ErdLayout>("hierarchical");

  // One field, so the picker can be the shared `Control` rather than the only
  // native `<select>` left on this screen.
  const layoutForm = useForm({
    schema: z.object({ layout: z.text() }),
    initialValues: { layout },
    keepDirty: false,
    handler: async () => {},
    onChange: (_key, next) => setLayout(next as ErdLayout),
  });
  /**
   * Compact by default on a real schema. Full column lists are readable for
   * the handful of tables a demo has; at 30+ they fit-zoom into illegibility,
   * and the join structure — the reason to open an ERD — is what gets lost.
   *
   * Derived rather than seeded into state: this component first renders with
   * an empty list while the metadata loads, so a `useState` initialiser would
   * capture 0 entities and the default would never apply.
   */
  const [compactOverride, setCompactOverride] = useState<boolean | null>(null);
  const compact = compactOverride ?? props.entities.length > 12;
  const [find, setFind] = useState("");
  const [selected, setSelected] = useState("");
  const [counts, setCounts] = useState({ entities: 0, relations: 0 });
  const [fitKey, setFitKey] = useState(0);

  const onCounts = useCallback(
    (entities: number, relations: number) =>
      setCounts((prev) =>
        prev.entities === entities && prev.relations === relations
          ? prev
          : { entities, relations },
      ),
    [],
  );

  const entity = useMemo(
    () => props.entities.find((e) => e.name === selected),
    [props.entities, selected],
  );

  if (props.entities.length === 0) {
    return (
      <DevEmpty
        title="No entities declared"
        hint="Use $entity to declare your data model"
      />
    );
  }

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        flex: 1,
        minWidth: 0,
        minHeight: 0,
      }}
    >
      <div className="dt-toolbar">
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
            style={{ width: 190, paddingLeft: 22 }}
            placeholder="Find entity…"
            value={find}
            onChange={(e) => setFind(e.currentTarget.value)}
          />
        </span>

        {/* Width on the wrapper, never on the trigger — see `DT_TRIGGER`. */}
        <div style={{ width: 130 }}>
          <Control
            input={layoutForm.input.layout}
            label=""
            inputProps={{ "aria-label": "Diagram layout" }}
            triggerClassName={DT_TRIGGER}
            items={[
              { value: "hierarchical", label: "hierarchical" },
              { value: "grid", label: "grid" },
              { value: "circular", label: "circular" },
            ]}
          />
        </div>

        <button
          type="button"
          className="dt-btn"
          data-on={compact || undefined}
          onClick={() => setCompactOverride(!compact)}
          title="Show only keys and relations"
        >
          Compact
        </button>

        <button
          type="button"
          className="dt-btn"
          onClick={() => setFitKey((k) => k + 1)}
        >
          <Maximize2 size={11} /> Fit
        </button>

        <span style={{ marginLeft: "auto" }} />
        <span
          className="dt-mono"
          style={{ fontSize: 10, color: "var(--dt-fg-faint)" }}
        >
          {counts.entities} entities · {counts.relations} relations
        </span>
      </div>

      <div style={{ display: "flex", flex: 1, minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
          <ReactFlowProvider>
            <ErdCanvas
              key={fitKey}
              entities={props.entities}
              layout={layout}
              compact={compact}
              find={find}
              selected={selected}
              onSelect={setSelected}
              onCounts={onCounts}
            />
          </ReactFlowProvider>
        </div>

        {entity && <SchemaDetail entity={entity} />}
      </div>
    </div>
  );
};
