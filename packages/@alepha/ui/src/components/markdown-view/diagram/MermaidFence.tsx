import * as React from "react";

void React;

import type { ReactNode } from "react";

import { FlowchartDiagram } from "./FlowchartDiagram.tsx";
import { parseFlowchart } from "./flowchartParser.ts";
import { layoutFlowchart } from "./layoutFlowchart.ts";

export interface MermaidFenceProps {
  /** The raw text between the fence markers. */
  source: string;
  /**
   * What to render when the source is not a flowchart we can draw. Always
   * the code block the fence would otherwise have produced.
   */
  fallback: ReactNode;
}

/**
 * The lazy chunk's entry point: parse, lay out, draw - or hand back the
 * fence untouched.
 *
 * This is the ONLY module that pulls in the parser, `graphre` and the
 * emitter, and it is imported through `lazy()` from `markdown-view.tsx`.
 * That is the epic's whole constraint: a document with no diagram must pay
 * nothing at all.
 *
 * **Failure is always the code block, silently.** Agents write invalid
 * mermaid, and a red error box in the middle of a folio is worse than a grey
 * fence. A parse failure, a graph past the cap, and a `sequenceDiagram` all
 * land here identically.
 */
export const MermaidFence = (props: MermaidFenceProps) => {
  const model = parseFlowchart(props.source);
  const graph = model ? layoutFlowchart(model) : undefined;
  if (!graph) return <>{props.fallback}</>;
  return <FlowchartDiagram graph={graph} />;
};

// Default export as well, so the `lazy()` call site stays a bare
// `import(...)` with no `.then(m => ({ default: m.X }))` wrapper.
export default MermaidFence;
