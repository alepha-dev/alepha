import * as React from "react";

void React;

import { round } from "./FlowchartDiagram.tsx";
import type { PositionedCluster } from "./layoutFlowchart.ts";
import { DIAGRAM_FONT_SIZE } from "./textMetrics.ts";

export interface FlowchartDiagramClusterProps {
  cluster: PositionedCluster;
}

/**
 * One `subgraph` box, drawn behind its members.
 *
 * The fill alpha grows with nesting depth so an inner cluster reads as
 * inside its parent rather than beside it. `--muted` at a low alpha is dark
 * on light and light on dark, so one value works in both themes.
 */
export const FlowchartDiagramCluster = (
  props: FlowchartDiagramClusterProps,
) => {
  const cluster = props.cluster;
  const x = round(cluster.x);
  const y = round(cluster.y);

  return (
    <g data-cluster={cluster.id}>
      <rect
        data-cluster={cluster.id}
        x={x}
        y={y}
        width={round(cluster.width)}
        height={round(cluster.height)}
        rx={8}
        ry={8}
        fill="var(--muted)"
        fillOpacity={Math.min(0.35 + cluster.depth * 0.2, 0.8)}
        stroke="var(--border)"
        strokeWidth={1}
        strokeDasharray="4 3"
      />
      {/*
        Top-left, just inside the box, on the same baseline arithmetic the
        node labels use. A cluster title is a single line by construction:
        the parser never splits it.
      */}
      <text
        x={round(x + 10)}
        y={round(y + DIAGRAM_FONT_SIZE + 4)}
        fill="var(--muted-foreground)"
        fontSize={DIAGRAM_FONT_SIZE * 0.9}
        fontWeight={500}
      >
        {cluster.label}
      </text>
    </g>
  );
};
