/**
 * What every markdown-carrying MCP surface says about diagrams.
 *
 * One constant because there are eight call sites (folio create/update,
 * quest description, quest comment, both completion messages, both epic
 * descriptions) and an agent writes what the tool description tells it it
 * can write. A surface that forgets this line is a surface where diagrams
 * are dead on arrival, and eight hand-copied sentences would drift.
 *
 * It names what is NOT supported in the same breath on purpose: an agent
 * that writes `sequenceDiagram`, sees a grey code block and is told nothing
 * will keep trying.
 */
export const DIAGRAM_CAPABILITY =
  "A ```mermaid fence renders as a real diagram: `flowchart` (TD/LR/BT/RL), " +
  "nodes `[rect]` `(rounded)` `{diamond}` `((circle))` and every other mermaid " +
  "bracket pair mapped onto those four, edges `-->` `---` `-.->` `==>` `<-->` " +
  "with labels in both the `-->|text|` and `-- text -->` forms, chains, `&` fans, " +
  "`<br/>` line breaks and nested `subgraph`. " +
  "Everything else degrades silently to a plain code block: `sequenceDiagram`, " +
  "`classDiagram`, `gantt` and mindmaps are not drawn, and `style` / `classDef` " +
  "are ignored because the theme picks the colours.";
