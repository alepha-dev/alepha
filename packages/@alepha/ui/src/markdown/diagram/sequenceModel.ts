/**
 * How a message line is stroked. The double hyphen in the arrow token is
 * what makes it dashed: `-->>` is the dashed form of `->>`.
 */
export type SequenceLineStyle = "solid" | "dashed";

/**
 * What sits at the far end of a message line.
 *
 * Four kinds and not one, deliberately. Epic #5's flowchart emitter shipped
 * a single end marker, which is exactly why `--o` and `--x` silently draw
 * the same head as `-->` there. Mermaid's four are all distinct here:
 *
 * | token         | line   | head    |
 * | ------------- | ------ | ------- |
 * | `->` / `-->`  | either | `none`  |
 * | `->>` / `-->>`| either | `arrow` |
 * | `-x` / `--x`  | either | `cross` |
 * | `-)` / `--)`  | either | `open`  |
 */
export type SequenceArrowHead = "none" | "arrow" | "cross" | "open";

/**
 * The fragment boxes v1 draws. `par`, `critical` and `break` are NOT here:
 * they refuse the whole diagram rather than be drawn as though their
 * branches happened in order, which would be a lie about the protocol.
 */
export type SequenceFragmentKind = "alt" | "opt" | "loop";

export interface SequenceParticipant {
  id: string;
  /**
   * The label, already split on `<br/>`. Never empty: a bare id is its own
   * label, and an `as` alias replaces it.
   */
  lines: string[];
  /**
   * Declared with `actor` rather than `participant`. The emitter draws a
   * stick figure instead of a box, so the distinction survives the parser.
   */
  actor: boolean;
}

export interface SequenceMessage {
  kind: "message";
  /**
   * Participant ids, always present in `participants`.
   */
  from: string;
  to: string;
  /**
   * The label, split on `<br/>`. May be a single empty string.
   *
   * The `autonumber` counter is NOT in here: it is applied at measure time,
   * because the counter is part of the label's width and numbering after
   * measuring makes every column too narrow.
   */
  lines: string[];
  line: SequenceLineStyle;
  head: SequenceArrowHead;
  /**
   * `from === to`. Flagged rather than derived because layout treats a self
   * message completely differently: it loops out to the right instead of
   * crossing a gap.
   */
  self: boolean;
}

export interface SequenceNote {
  kind: "note";
  placement: "left" | "right" | "over";
  /**
   * One id, or two for `Note over A,B`. Every id is present in
   * `participants`: a note naming one that never appears anywhere is
   * malformed and refuses the diagram.
   */
  participants: string[];
  lines: string[];
}

/**
 * One row of the diagram. Messages and notes share the list because they
 * share the vertical axis: both take a row, and a fragment can span either.
 */
export type SequenceStep = SequenceMessage | SequenceNote;

export interface SequenceFragmentDivider {
  /**
   * Index into `steps` of the first step BELOW the divider.
   */
  at: number;
  label: string;
}

/**
 * A box drawn around a span of rows.
 *
 * `from` / `to` index into `steps` and are inclusive. Spans rather than
 * nesting is the load-bearing decision: the parser sees a tree while
 * reading `alt` / `else` / `end`, but a tree would force the layout to
 * recurse while threading a y-cursor through it, for no gain. Flat plus
 * spans means row `y` comes from one sequential pass and a box is min/max
 * over its span.
 */
export interface SequenceFragment {
  kind: SequenceFragmentKind;
  label: string;
  from: number;
  to: number;
  /**
   * 0 for an outermost fragment, 1 for one nested inside it, and so on. The
   * layout insets the box horizontally by this.
   */
  depth: number;
  dividers: SequenceFragmentDivider[];
}

export interface SequenceAutonumber {
  start: number;
  step: number;
}

/**
 * A sequence diagram as data: what the parser produces and the layout
 * consumes. Nothing positional, nothing rendered, no DOM.
 *
 * Participants are in declaration order, which IS their left-to-right
 * order, and `steps` is in source order, which IS their top-to-bottom
 * order. That is why no layout library is involved: unlike a flowchart
 * there is no ranking to compute, so both axes are already decided here.
 */
export interface SequenceModel {
  participants: SequenceParticipant[];
  steps: SequenceStep[];
  fragments: SequenceFragment[];
  /**
   * Set when the diagram declared `autonumber`. The layout prefixes each
   * message label with the running counter before measuring it.
   */
  autonumber?: SequenceAutonumber;
}
