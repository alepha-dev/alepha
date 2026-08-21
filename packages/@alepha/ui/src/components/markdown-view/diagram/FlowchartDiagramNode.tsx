import * as React from "react";

void React;

import { round } from "./FlowchartDiagram.tsx";
import { FlowchartDiagramLabel } from "./FlowchartDiagramLabel.tsx";
import type { PositionedNode } from "./layoutFlowchart.ts";

export interface FlowchartDiagramNodeProps {
  node: PositionedNode;
  fontSize: number;
}

/**
 * One box and its label.
 *
 * The four shapes are drawn with four primitives rather than one `path`
 * each, so the SVG stays readable and a rounded rect is literally a rect
 * with an `rx`. Colours are CSS variables throughout: an element with no
 * class at all survives being extracted, and dark mode needs no second
 * palette.
 */
export const FlowchartDiagramNode = (props: FlowchartDiagramNodeProps) => {
  const node = props.node;
  const x = round(node.x);
  const y = round(node.y);
  const width = round(node.width);
  const height = round(node.height);

  return (
    <g data-node={node.id}>
      {node.shape === "diamond" ? (
        <polygon
          points={[
            `${round(x + width / 2)},${y}`,
            `${round(x + width)},${round(y + height / 2)}`,
            `${round(x + width / 2)},${round(y + height)}`,
            `${x},${round(y + height / 2)}`,
          ].join(" ")}
          fill="var(--card)"
          stroke="var(--border)"
          strokeWidth={1.25}
        />
      ) : node.shape === "circle" ? (
        <ellipse
          cx={round(x + width / 2)}
          cy={round(y + height / 2)}
          rx={round(width / 2)}
          ry={round(height / 2)}
          fill="var(--card)"
          stroke="var(--border)"
          strokeWidth={1.25}
        />
      ) : (
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          // A "rounded" node is a stadium in mermaid, so the radius is half
          // the height rather than a fixed corner.
          rx={node.shape === "rounded" ? round(height / 2) : 5}
          ry={node.shape === "rounded" ? round(height / 2) : 5}
          fill="var(--card)"
          stroke="var(--border)"
          strokeWidth={1.25}
        />
      )}
      <FlowchartDiagramLabel
        lines={node.lines}
        centerX={x + width / 2}
        centerY={y + height / 2}
        fontSize={props.fontSize}
        fill="var(--card-foreground)"
      />
    </g>
  );
};
