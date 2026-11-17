import "@xyflow/react/dist/style.css";
import "./AutomationCanvas.css";
import {
  Background,
  BackgroundVariant,
  type Connection,
  Controls,
  type Edge,
  type EdgeChange,
  type NodeChange,
  type NodeTypes,
  ReactFlow,
} from "@xyflow/react";
import { useI18n } from "alepha/react/i18n";
import { useMemo, useState } from "react";

import type { AutomationGraphEdge } from "../../../../../../api/schemas/automationGraphEdgeSchema.ts";
import type { AutomationGraphValue } from "../../../../../../api/schemas/automationGraphSchema.ts";
import type { AutomationNodeOutcome } from "../../../../../../api/schemas/automationNodeOutcomeSchema.ts";
import type { AutomationResourceSource } from "../../../../../../api/schemas/automationResourceSourceSchema.ts";
import type { I18n } from "../../../../services/I18n.ts";
import AutomationActionNode from "./AutomationActionNode.tsx";
import {
  type AutomationCanvasEditing,
  AutomationCanvasMap,
  type AutomationCanvasNames,
} from "./AutomationCanvasMap.ts";
import AutomationCanvasMeasure from "./AutomationCanvasMeasure.tsx";
import AutomationConditionNode from "./AutomationConditionNode.tsx";
import AutomationReadNode from "./AutomationReadNode.tsx";
import AutomationSourceNode from "./AutomationSourceNode.tsx";

export interface AutomationCanvasInnerProps {
  graph: AutomationGraphValue;
  /**
   * The automation's sources, for their state dots.
   */
  sources?: AutomationResourceSource[];
  /**
   * A run's per-node evidence, painted on the graph.
   */
  outcomes?: AutomationNodeOutcome[];
  names?: AutomationCanvasNames;
  selected?: string;
  onSelect: (node: string | undefined) => void;
  /**
   * Present, the canvas edits (#Q3811): drag, wire, delete, "+".
   */
  editing?: AutomationCanvasEditing;
}

/**
 * One component per kind; a reserved `transform` draws as a plain step.
 */
const NODE_TYPES: NodeTypes = {
  source: AutomationSourceNode,
  read: AutomationReadNode,
  condition: AutomationConditionNode,
  action: AutomationActionNode,
  transform: AutomationReadNode,
};

/**
 * The React Flow half of the automation canvas (#Q3810), loaded only
 * through the lazy `AutomationCanvas`, so no other page carries React Flow.
 *
 * Read-only, it pans, zooms and fits; the page scrolls over it, and zoom is
 * the controls or a pinch. Editing (#Q3811), it also drags nodes, draws
 * wires (a wire the graph refuses is refused while dragged, its reason on
 * the canvas), and deletes the selection with Delete or Backspace. The
 * graph stays the parent's: every change goes back through `editing`.
 */
const AutomationCanvasInner = (props: AutomationCanvasInnerProps) => {
  const { tr } = useI18n<I18n, "en">();
  const [edges, setEdges] = useState<Set<string>>(new Set());
  const [refusal, setRefusal] = useState<string>();
  // The canvas owns its nodes, so it keeps what React Flow measured of
  // them: a node not given its size back stays hidden.
  const [sizes, setSizes] = useState<
    Record<string, { width: number; height: number }>
  >({});
  const editing = props.editing;
  const ports = {
    true: tr("automation.canvas.port.true"),
    false: tr("automation.canvas.port.false"),
  };
  const mapped = useMemo(() => {
    const { nodes, edges: wires } = new AutomationCanvasMap().map({
      graph: props.graph,
      sources: props.sources,
      outcomes: props.outcomes,
      selected: props.selected,
      names: props.names,
      issues: editing?.issues,
    });
    return {
      nodes: nodes.map((node) => ({
        ...node,
        ...(sizes[node.id] ? { measured: sizes[node.id] } : {}),
        ...(editing
          ? {
              data: {
                ...node.data,
                onAdd: (port: AutomationGraphEdge["port"]) =>
                  editing.onAdd(node.id, port),
              },
            }
          : {}),
      })),
      edges: wires.map((edge): Edge => ({
        ...edge,
        selected: edges.has(edge.id),
        // A condition's wires say which way they go.
        ...(edge.data?.port === "true" || edge.data?.port === "false"
          ? {
              label: ports[edge.data.port],
              labelBgPadding: [4, 2] as [number, number],
              labelBgBorderRadius: 4,
            }
          : {}),
        focusable: !!editing,
        className:
          edge.data?.walked === undefined
            ? undefined
            : edge.data.walked
              ? "lore-edge-walked"
              : "lore-edge-unwalked",
      })),
    };
  }, [
    props.graph,
    props.sources,
    props.outcomes,
    props.selected,
    props.names,
    editing,
    edges,
    sizes,
    ports.true,
    ports.false,
  ]);
  const wire = (connection: Connection | Edge): AutomationGraphEdge => ({
    from: connection.source,
    port: (connection.sourceHandle ?? "out") as AutomationGraphEdge["port"],
    to: connection.target,
  });
  const onNodesChange = (changes: NodeChange[]) => {
    const positions: Record<string, { x: number; y: number }> = {};
    const measured: Record<string, { width: number; height: number }> = {};
    for (const change of changes) {
      if (change.type === "dimensions" && change.dimensions)
        measured[change.id] = change.dimensions;
      if (change.type === "position" && change.position)
        positions[change.id] = change.position;
      if (change.type === "select")
        props.onSelect(
          change.selected
            ? change.id
            : props.selected === change.id
              ? undefined
              : props.selected,
        );
    }
    if (Object.keys(measured).length)
      setSizes((current) =>
        Object.entries(measured).every(
          ([id, size]) =>
            current[id]?.width === size.width &&
            current[id]?.height === size.height,
        )
          ? current
          : { ...current, ...measured },
      );
    if (editing && Object.keys(positions).length) editing.onMove(positions);
  };
  const onEdgesChange = (changes: EdgeChange[]) =>
    setEdges((current) => {
      const next = new Set(current);
      for (const change of changes)
        if (change.type === "select") {
          if (change.selected) next.add(change.id);
          else next.delete(change.id);
        }
      return next;
    });
  return (
    <div
      className="lore-automation-canvas bg-muted/20 relative h-80 w-full overflow-hidden rounded-lg border sm:h-[28rem]"
      data-testid="automation-canvas"
      data-editing={editing ? true : undefined}
      aria-label={tr("automation.canvas.label")}
      role="group"
    >
      <ReactFlow
        nodes={mapped.nodes}
        edges={mapped.edges}
        nodeTypes={NODE_TYPES}
        nodesDraggable={!!editing}
        nodesConnectable={!!editing}
        nodesFocusable
        edgesFocusable={!!editing}
        elementsSelectable
        deleteKeyCode={editing ? ["Delete", "Backspace"] : null}
        zoomOnScroll={false}
        preventScrolling={false}
        minZoom={0.2}
        maxZoom={1.5}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        // A click selects through `onNodesChange`, as Enter on a focused
        // node does, so the selection has one way in.
        onPaneClick={() => {
          props.onSelect(undefined);
          setEdges(new Set());
        }}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStart={() => editing?.onDragStart()}
        isValidConnection={(connection) => {
          const reason = editing?.refuse(wire(connection));
          setRefusal(reason);
          return !reason;
        }}
        onConnect={(connection) => {
          setRefusal(undefined);
          if (editing && !editing.refuse(wire(connection)))
            editing.onConnect(wire(connection));
        }}
        onConnectEnd={() => setRefusal(undefined)}
        onDelete={({ nodes, edges: removed }) => {
          editing?.onDelete({
            nodes: nodes.map((node) => node.id),
            edges: removed.map((edge) => edge.id),
          });
          setEdges(new Set());
        }}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        <Controls showInteractive={false} />
        <AutomationCanvasMeasure nodes={mapped.nodes} />
      </ReactFlow>
      {refusal && (
        <p
          role="status"
          className="bg-card text-danger-text absolute inset-x-3 top-3 rounded-md border px-3 py-2 text-xs shadow-sm"
          data-testid="automation-canvas-refusal"
        >
          {refusal}
        </p>
      )}
    </div>
  );
};

export default AutomationCanvasInner;
