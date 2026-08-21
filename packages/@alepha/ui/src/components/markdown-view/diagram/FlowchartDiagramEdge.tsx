import * as React from "react";

void React;

import { round } from "./FlowchartDiagram.tsx";
import { FlowchartDiagramLabel } from "./FlowchartDiagramLabel.tsx";
import type { PositionedEdge } from "./layoutFlowchart.ts";

export interface FlowchartDiagramEdgeProps {
  edge: PositionedEdge;
  /** Instance-unique prefix for the arrowhead marker ids. */
  scope: string;
  fontSize: number;
}

/**
 * One routed edge, its arrowheads and its label chip.
 *
 * `currentColor` on the path is what makes the arrowhead markers match: a
 * marker inherits `currentColor` from the element that references it, so
 * one pair of markers serves every edge colour without a marker per style.
 */
export const FlowchartDiagramEdge = (props: FlowchartDiagramEdgeProps) => {
  const edge = props.edge;

  return (
    <g style={{ color: "var(--muted-foreground)" }}>
      <path
        data-edge={`${edge.from}->${edge.to}`}
        d={pathOf(edge.points)}
        fill="none"
        stroke="currentColor"
        strokeWidth={edge.style === "thick" ? 2.5 : 1.4}
        strokeDasharray={edge.style === "dashed" ? "5 4" : undefined}
        strokeLinecap="round"
        strokeLinejoin="round"
        markerEnd={edge.arrowEnd ? `url(#${props.scope}-arrow-end)` : undefined}
        markerStart={
          edge.arrowStart ? `url(#${props.scope}-arrow-start)` : undefined
        }
      />
      {edge.label ? (
        <>
          {/*
            The chip is what stops the line running through the text. It is
            drawn in `--background` rather than `--card` so it reads as a
            hole in the edge rather than as a small node.
          */}
          <rect
            data-edge-label={`${edge.from}->${edge.to}`}
            x={round(edge.label.x)}
            y={round(edge.label.y)}
            width={round(edge.label.width)}
            height={round(edge.label.height)}
            rx={4}
            ry={4}
            fill="var(--background)"
          />
          <FlowchartDiagramLabel
            lines={edge.label.lines}
            centerX={edge.label.x + edge.label.width / 2}
            centerY={edge.label.y + edge.label.height / 2}
            fontSize={props.fontSize * 0.92}
            fill="var(--muted-foreground)"
          />
        </>
      ) : null}
    </g>
  );
};

/**
 * A rounded polyline through graphre's point list.
 *
 * Quadratic segments through the midpoints round every corner without any
 * curve fitting: each control point is the original vertex, so the line
 * still passes where the layout routed it.
 */
const pathOf = (points: Array<{ x: number; y: number }>): string => {
  const at = (index: number) =>
    `${round(points[index].x)},${round(points[index].y)}`;
  if (points.length === 2) return `M${at(0)} L${at(1)}`;

  let d = `M${at(0)}`;
  for (let i = 1; i < points.length - 1; i++) {
    const current = points[i];
    const next = points[i + 1];
    const midX = round((current.x + next.x) / 2);
    const midY = round((current.y + next.y) / 2);
    d += ` Q${round(current.x)},${round(current.y)} ${midX},${midY}`;
  }
  return `${d} L${at(points.length - 1)}`;
};
