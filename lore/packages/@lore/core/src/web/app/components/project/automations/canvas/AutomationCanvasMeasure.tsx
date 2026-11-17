import { type Node, useUpdateNodeInternals } from "@xyflow/react";
import { useEffect } from "react";

export interface AutomationCanvasMeasureProps {
  nodes: Node[];
}

/**
 * Asks React Flow to measure the canvas's nodes again after each change of
 * them (#Q3810). The canvas owns its nodes, and a node handed back without
 * the size React Flow measured loses its handles' places, so its wires are
 * not drawn until it is measured again; a size that did not change stops
 * there. Rendered inside `ReactFlow`, whose store it reaches.
 */
const AutomationCanvasMeasure = (props: AutomationCanvasMeasureProps) => {
  const update = useUpdateNodeInternals();
  useEffect(() => {
    const frame = requestAnimationFrame(() =>
      update(props.nodes.map((node) => node.id)),
    );
    return () => cancelAnimationFrame(frame);
  }, [props.nodes, update]);
  return null;
};

export default AutomationCanvasMeasure;
