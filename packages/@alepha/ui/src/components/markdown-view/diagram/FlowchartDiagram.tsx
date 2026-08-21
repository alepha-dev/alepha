import * as React from "react";

void React;

import { useId } from "react";

import { FlowchartDiagramCluster } from "./FlowchartDiagramCluster.tsx";
import { FlowchartDiagramEdge } from "./FlowchartDiagramEdge.tsx";
import { FlowchartDiagramNode } from "./FlowchartDiagramNode.tsx";
import type { PositionedGraph } from "./layoutFlowchart.ts";
import { DIAGRAM_FONT_FAMILY } from "./textMetrics.ts";

export interface FlowchartDiagramProps {
  graph: PositionedGraph;
  /** Read out to assistive technology as the diagram's name. */
  title?: string;
}

/**
 * Draw a laid-out flowchart as themed SVG.
 *
 * ## React elements, not an HTML string, and this is not negotiable
 *
 * `markdown-view.tsx` carries an explicit rule that no raw HTML is ever
 * promoted to markup, because it renders one user's content to another and
 * every raw tag would turn every markdown surface in every app into an
 * injection point. Emitting React elements means labels are escaped by React
 * itself and `dangerouslySetInnerHTML` never appears on this path. Read that
 * comment before "optimising" this into a string.
 *
 * ## Theming is the point
 *
 * Colours come from `--primary`, `--border`, `--muted-foreground`, `--card`
 * and `--muted` through `var(...)`, so dark mode works with no second
 * palette and no theme prop. That is the thing mermaid can structurally
 * never give us, and the whole reason drawing is our own code rather than a
 * cost.
 *
 * ## The font is pinned, never inherited
 *
 * Folio view mode and the quest description set prose in Literata at 16.5px,
 * lazy-loaded after first paint; every other surface is Inter. The width
 * table in `textMetrics.ts` is generated against Inter at
 * `DIAGRAM_FONT_SIZE`, so inheriting would make text and box disagree per
 * surface and shift when the serif arrives.
 */
export const FlowchartDiagram = (props: FlowchartDiagramProps) => {
  const graph = props.graph;
  // SVG marker ids are global to the document: two diagrams on one page with
  // the same arrowhead id fight, and the loser's arrows vanish.
  const scope = useId().replace(/[^\w-]/g, "");

  return (
    <svg
      role="img"
      viewBox={`0 0 ${round(graph.width)} ${round(graph.height)}`}
      // No `width`: the diagram scales to its container, and `max-width`
      // stops a two-node graph being blown up to the full column.
      style={{ maxWidth: `${round(graph.width)}px`, height: "auto" }}
      className="my-4 block w-full"
      // camelCase, not `font-family` / `font-size`: React renders these as
      // the hyphenated SVG presentation attributes either way, but the
      // hyphenated spelling is an "Invalid DOM property" warning on every
      // render - noise in a component mounted on every markdown surface in
      // the app.
      fontFamily={DIAGRAM_FONT_FAMILY}
      fontSize={graph.fontSize}
      xmlns="http://www.w3.org/2000/svg"
    >
      <title>{props.title ?? "Flowchart diagram"}</title>
      <defs>
        <marker
          id={`${scope}-arrow-end`}
          markerWidth="9"
          markerHeight="7"
          refX="8"
          refY="3.5"
          orient="auto"
          markerUnits="userSpaceOnUse"
        >
          {/*
            `context-stroke`, not `currentColor`. A marker lives in `<defs>`,
            so `currentColor` resolves against the MARKER's inherited colour,
            not the edge's - the arrowhead came out `--foreground` while its
            line was `--muted-foreground`, and in a differently-themed
            container it was the wrong colour outright.
          */}
          <path d="M0,0 L9,3.5 L0,7 z" fill="context-stroke" />
        </marker>
        <marker
          id={`${scope}-arrow-start`}
          markerWidth="9"
          markerHeight="7"
          refX="1"
          refY="3.5"
          orient="auto-start-reverse"
          markerUnits="userSpaceOnUse"
        >
          <path d="M0,0 L9,3.5 L0,7 z" fill="context-stroke" />
        </marker>
      </defs>

      {/*
        Order IS z-order in SVG, so clusters (sorted outermost first by the
        layout adapter) go down first, then edges, then nodes on top. No
        z-index anywhere, and nothing to keep in sync.
      */}
      {graph.clusters.map((cluster) => (
        <FlowchartDiagramCluster key={cluster.id} cluster={cluster} />
      ))}
      {graph.edges.map((edge, index) => (
        <FlowchartDiagramEdge
          key={`${edge.from}->${edge.to}#${index}`}
          edge={edge}
          scope={scope}
          fontSize={graph.fontSize}
        />
      ))}
      {graph.nodes.map((node) => (
        <FlowchartDiagramNode
          key={node.id}
          node={node}
          fontSize={graph.fontSize}
        />
      ))}
    </svg>
  );
};

/**
 * Two decimals is plenty for a diagram and keeps the emitted attributes
 * readable; graphre's raw coordinates carry a dozen.
 */
export const round = (value: number): number => Math.round(value * 100) / 100;
