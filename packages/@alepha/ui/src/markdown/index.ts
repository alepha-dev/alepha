/**
 * Markdown rendered as prose, with diagrams.
 *
 * `MarkdownView` renders GitHub-flavoured markdown with highlighted code, and
 * draws `flowchart` and `sequenceDiagram` fences as SVG. `diagramKind`,
 * `parseFlowchart` and `parseSequence` expose the parsers, so an editor can
 * validate a diagram before it is saved.
 *
 * Imports its own stylesheet, so it is loaded through a bundler rather than
 * plain Node.
 *
 * @module alepha.ui.markdown
 */

export { diagramKind } from "./diagram/diagramKind.ts";
export { parseFlowchart } from "./diagram/flowchartParser.ts";
export { parseSequence } from "./diagram/sequenceParser.ts";
export { MarkdownView, type MarkdownViewProps } from "./MarkdownView.tsx";
