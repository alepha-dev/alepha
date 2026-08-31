/**
 * What every markdown-carrying MCP surface says about diagrams.
 *
 * One constant because there are eight call sites (folio create/update,
 * quest description, quest comment, both completion messages, both epic
 * descriptions) and an agent writes what the tool description tells it it
 * can write. A surface that forgets this line is a surface where diagrams
 * are dead on arrival, and eight hand-copied sentences would drift.
 *
 * ## ⚠️ It rides on PARAMETER descriptions, never a tool description
 *
 * Not a style preference. On 2026-08-21 this string reached an agent through
 * `epic_create.description`, `epic_update.description` and
 * `quest_create.description` - all parameter `.describe()` slots - and did
 * NOT reach it through `folio_create`'s tool-level `description`, before or
 * after a reconnect. Nothing in Lore or the framework truncates it
 * (`$tool.ts` passes the value through untouched), so it is lost somewhere in
 * transport or a client cache, in a layer this app neither controls nor can
 * observe. Both folio tools were moved onto their `content` parameter, which
 * had no `.describe()` at all. **Adding a new carrier means adding it to a
 * parameter.**
 *
 * ## It is no longer the only channel, and that is why it can be short
 *
 * `DiagramCheckService` parses every ` ```mermaid ` fence an agent writes and
 * returns `diagramWarnings` in the tool RESULT, which always arrives. So this
 * string no longer has to be a complete grammar written defensively against
 * failures nobody can see: it carries what is needed BEFORE writing, and the
 * result carries what actually went wrong. Every trap listed here was found
 * the hard way; the parser finds the rest.
 *
 * Keep it that way. This file grows once per diagram type, and the budget is
 * the whole string, not the new section.
 *
 * ## Every claim here was measured, not read
 *
 * The rules below came from running `parseFlowchart` over each case, and two
 * of them contradict what an earlier version of this string asserted. A bare
 * `==` inside a label is SAFE (only `===` and `==>` cut it), and quoting DOES
 * protect a label whose first character is a bracket, while it does NOT
 * protect one containing a link operator. Do not edit these sentences from
 * memory of mermaid's own documentation - this is a subset parser, and it is
 * the subset that decides.
 */
export const DIAGRAM_CAPABILITY =
  "A ```mermaid fence draws ONLY `flowchart` and `sequenceDiagram`; anything " +
  "else, or anything that fails to parse, becomes a plain code block " +
  "silently. The write tool returns `diagramWarnings` when a diagram will " +
  "not draw as meant - read the result.\n" +
  "⚠️ **Labels.** A link operator inside `[...]` reads as an edge and cuts " +
  "the label in half: `--`, `-.-`, `===`, `==>`. Quoting does NOT protect " +
  "them, so reword. A single `-` and a bare `==` are safe. `{ ( [ >` are " +
  "safe INSIDE a label, but a label STARTING with `( [ / \\` pairs with the " +
  "opening bracket into another shape and loses both delimiters " +
  '(`a[/api/users]` draws `api/user`) - quote those: `a["/api/users"]`.\n' +
  "**Node ids** run to the first `[ ( { >`; `. / @ #` and a single `-` are " +
  "fine, `--` is not. Anything else belongs in a quoted label.\n" +
  "**flowchart** (TD/LR/BT/RL): `[rect]` `(rounded)` `{diamond}` " +
  "`((circle))` and every other bracket pair mapped onto those four; edges " +
  "`-->` `---` `-.->` `==>` `<-->` `--o` `--x`, labelled as `-->|text|` or " +
  "`-- text -->`; chains, `&` fans, `<br/>`; nested `subgraph id[Label]`, " +
  '`subgraph id["Label"]` or `subgraph Label` (title doubles as id).\n' +
  "**sequenceDiagram**: `participant`/`actor` with `as`, arrows `->` `-->` " +
  "`->>` `-->>` `-x` `--x` `-)` `--)` (all distinct), self-messages, `Note " +
  "left of/right of/over A[,B]`, `autonumber`, nested " +
  "`alt`/`else`/`opt`/`loop`. ⚠️ `par`, `critical`, `break`, `create` and " +
  "`destroy` refuse the WHOLE diagram rather than draw a false ordering. " +
  "`activate`, `rect`, `box`, `links`, `style` and `classDef` are ignored.";
