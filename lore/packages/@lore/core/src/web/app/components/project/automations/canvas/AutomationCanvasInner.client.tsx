import "@xyflow/react/dist/style.css";
import "./AutomationCanvas.css";
import {
  Background,
  BackgroundVariant,
  Controls,
  type NodeTypes,
  ReactFlow,
} from "@xyflow/react";
import { useI18n } from "alepha/react/i18n";
import { useMemo } from "react";

import type { AutomationGraphValue } from "../../../../../../api/schemas/automationGraphSchema.ts";
import type { AutomationNodeOutcome } from "../../../../../../api/schemas/automationNodeOutcomeSchema.ts";
import type { AutomationResourceSource } from "../../../../../../api/schemas/automationResourceSourceSchema.ts";
import type { I18n } from "../../../../services/I18n.ts";
import AutomationActionNode from "./AutomationActionNode.tsx";
import {
  AutomationCanvasMap,
  type AutomationCanvasNames,
} from "./AutomationCanvasMap.ts";
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
 * The React Flow half of the automation canvas (#Q3810), read-only: pan,
 * zoom and fit to view, no drag and no wiring. Loaded only through the lazy
 * `AutomationCanvas`, so no other page carries React Flow; the page scrolls
 * over it, and zoom is the controls or a pinch.
 */
const AutomationCanvasInner = (props: AutomationCanvasInnerProps) => {
  const { tr } = useI18n<I18n, "en">();
  const ports = {
    true: tr("automation.canvas.port.true"),
    false: tr("automation.canvas.port.false"),
  };
  const { nodes, edges } = useMemo(() => {
    const mapped = new AutomationCanvasMap().map({
      graph: props.graph,
      sources: props.sources,
      outcomes: props.outcomes,
      selected: props.selected,
      names: props.names,
    });
    return {
      nodes: mapped.nodes,
      edges: mapped.edges.map((edge) => ({
        ...edge,
        // A condition's wires say which way they go.
        ...(edge.data?.port === "true" || edge.data?.port === "false"
          ? {
              label: ports[edge.data.port],
              labelBgPadding: [4, 2] as [number, number],
              labelBgBorderRadius: 4,
            }
          : {}),
        focusable: false,
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
    ports.true,
    ports.false,
  ]);
  return (
    <div
      className="lore-automation-canvas bg-muted/20 h-80 w-full overflow-hidden rounded-lg border sm:h-[28rem]"
      data-testid="automation-canvas"
      aria-label={tr("automation.canvas.label")}
      role="group"
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={NODE_TYPES}
        nodesDraggable={false}
        nodesConnectable={false}
        nodesFocusable
        edgesFocusable={false}
        elementsSelectable
        zoomOnScroll={false}
        preventScrolling={false}
        minZoom={0.2}
        maxZoom={1.5}
        fitView
        fitViewOptions={{ padding: 0.15 }}
        onNodeClick={(_event, node) => props.onSelect(node.id)}
        onPaneClick={() => props.onSelect(undefined)}
      >
        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
};

export default AutomationCanvasInner;
