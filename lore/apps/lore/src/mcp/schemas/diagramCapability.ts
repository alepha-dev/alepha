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
 * that writes a `classDiagram`, sees a grey code block and is told nothing
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
 *
 * ## Two labelled sections, not one growing paragraph
 *
 * When `sequenceDiagram` was added it would have been natural to append its
 * subset to the end. That roughly doubles the length of a string already
 * embedded in eight descriptions, and buries the traps in the middle of it.
 * Each diagram type gets a short block of its own instead, with its own
 * warning line, and the shared degrade-to-a-code-block rule stays at the
 * bottom where it covers both. Keep it that way: this file grows once per
 * diagram type, and the budget is the whole string, not the new section.
 */
export const DIAGRAM_CAPABILITY =
  "A ```mermaid fence renders as a real diagram:\n" +
  "**flowchart** (TD/LR/BT/RL): nodes `[rect]` `(rounded)` `{diamond}` " +
  "`((circle))` and every other bracket pair mapped onto those four; edges " +
  "`-->` `---` `-.->` `==>` `<-->`, labels as `-->|text|` or `-- text -->`; " +
  "chains, `&` fans, `<br/>`, nested `subgraph`. `--o` and `--x` draw the " +
  "same arrowhead as `-->`. ⚠️ Never put a link operator in a node label: " +
  "`--`, `==` or `-.` inside `[...]` reads as an edge, so `A[--o]` and even " +
  'the quoted `A["-->"]` are silently cut in half - quoting does not ' +
  "protect them and the diagram still draws, with the wrong text. A single " +
  "hyphen is safe.\n" +
  "**sequenceDiagram**: `participant`/`actor` with `as` aliases, arrows " +
  "`->` `-->` `->>` `-->>` `-x` `--x` `-)` `--)` (all distinct), " +
  "self-messages, `Note left of/right of/over A[,B]`, `autonumber`, nested " +
  "`alt`/`else`/`opt`/`loop`. Activation bars are not drawn: `activate` and " +
  "the `+`/`-` suffixes are ignored. ⚠️ `par`, `critical`, `break`, `create` " +
  "and `destroy` refuse the WHOLE diagram rather than draw an ordering that " +
  "is false; `rect`, `box` and `links` are skipped in silence.\n" +
  "Everything else degrades silently to a plain code block: `classDiagram`, " +
  "`gantt` and mindmaps are not drawn, `style`/`classDef` are ignored " +
  "because the theme picks the colours, as is any diagram that fails to " +
  "parse or is past its size cap.";
