import * as React from "react";

void React;

import type { ReactNode } from "react";

import { FlowchartDiagram } from "./FlowchartDiagram.tsx";
import { parseFlowchart } from "./flowchartParser.ts";
import { layoutFlowchart } from "./layoutFlowchart.ts";
import { layoutSequence } from "./layoutSequence.ts";
import { SequenceDiagram } from "./SequenceDiagram.tsx";
import { parseSequence } from "./sequenceParser.ts";

export interface MermaidFenceProps {
  /**
   * The raw text between the fence markers.
   */
  source: string;
  /**
   * What to render when the source is not a diagram we can draw. Always the
   * code block the fence would otherwise have produced.
   */
  fallback: ReactNode;
}

/**
 * The lazy chunk's entry point, and the dispatcher between the two
 * pipelines: read the header, parse, lay out, draw - or hand back the fence
 * untouched.
 *
 * This is the ONLY module that pulls in either parser, `graphre` and either
 * emitter, and it is imported through `lazy()` from `markdown-view.tsx`.
 * That is the whole constraint the diagram layer lives under: a document
 * with no diagram must pay nothing at all.
 *
 * **The two pipelines are parallel, not shared.** A flowchart ranks a node
 * graph and needs a layout library; a sequence diagram has both axes
 * decided by source order and needs none. Lifelines, ordered messages and
 * fragment boxes have essentially nothing in common with nodes, edges and
 * clusters, so one model type for both would make both halves worse. What
 * they do share is the text metrics, the theming, the marker namespacing,
 * the error boundary and the policy below.
 *
 * **Failure is always the code block, silently.** A parse failure, a
 * refused construct, a diagram past its cap, and a `classDiagram` all land
 * here identically. Agents write invalid mermaid, and a red error box in
 * the middle of a folio is worse than a grey fence.
 */
export const MermaidFence = (props: MermaidFenceProps) => {
  const kind = diagramKind(props.source);

  if (kind === "sequence") {
    const model = parseSequence(props.source);
    const diagram = model ? layoutSequence(model) : undefined;
    return diagram ? (
      <SequenceDiagram diagram={diagram} />
    ) : (
      <>{props.fallback}</>
    );
  }

  if (kind === "flowchart") {
    const model = parseFlowchart(props.source);
    const graph = model ? layoutFlowchart(model) : undefined;
    return graph ? <FlowchartDiagram graph={graph} /> : <>{props.fallback}</>;
  }

  return <>{props.fallback}</>;
};

/**
 * Which pipeline a fence belongs to, from its header line.
 *
 * The header is the first line that is not YAML frontmatter, a
 * `%%{init: …}%%` directive or a `%%` comment - mermaid allows all three
 * above it. Both parsers check their own header again, because both are
 * independently callable; this exists so an unsupported diagram type never
 * enters a parser at all.
 */
const diagramKind = (source: string): "sequence" | "flowchart" | undefined => {
  const header = source
    .replace(/^\s*---\r?\n[\s\S]*?\r?\n---\r?\n/, "")
    .replace(/%%\{[\s\S]*?\}%%/g, "")
    .split(/\r?\n/)
    .map((line) => line.replace(/%%.*$/, "").trim())
    .find(Boolean);

  if (!header) return undefined;
  if (/^sequenceDiagram\b/i.test(header)) return "sequence";
  if (/^(?:flowchart|graph)\b/i.test(header)) return "flowchart";
  return undefined;
};

// Default export as well, so the `lazy()` call site stays a bare
// `import(...)` with no `.then(m => ({ default: m.X }))` wrapper.
export default MermaidFence;
