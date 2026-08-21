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
 *
 * ⚠️ **This string is the ONLY documentation of the format an agent ever
 * sees**, and it is deliberately the only one. No `CLAUDE.md` carries it:
 * a repo instruction file reaches agents working in THIS checkout, while
 * every folio and quest is also written from other projects and from
 * claude.ai chat, where no such file is loaded. A tool description travels
 * with the tool, so it is the one surface that reaches all of them.
 *
 * That is why the silent-failure traps are spelled out here rather than
 * merely linked. An agent cannot see that its label was cut - the diagram
 * still draws - so anything it is not told here, it will never learn.
 */
export const DIAGRAM_CAPABILITY =
  "A ```mermaid fence renders as a real diagram: `flowchart` (TD/LR/BT/RL), " +
  "nodes `[rect]` `(rounded)` `{diamond}` `((circle))` and every other mermaid " +
  "bracket pair mapped onto those four, edges `-->` `---` `-.->` `==>` `<-->` " +
  "with labels in both the `-->|text|` and `-- text -->` forms, chains, `&` fans, " +
  "`<br/>` line breaks and nested `subgraph`. " +
  "Everything else degrades silently to a plain code block: `sequenceDiagram`, " +
  "`classDiagram`, `gantt` and mindmaps are not drawn, and `style` / `classDef` " +
  "are ignored because the theme picks the colours. " +
  "`--o` and `--x` are accepted but draw the same arrowhead as `-->`. " +
  "⚠️ Never put a link operator inside a node label: a `--`, `==` or `-.` " +
  "sequence inside `[...]` is read as an edge, so `A[--o]` and even the quoted " +
  '`A["-->"]` are silently cut in half - quoting does not protect them, and ' +
  "the diagram still draws, with the wrong text. A single hyphen is safe.";
