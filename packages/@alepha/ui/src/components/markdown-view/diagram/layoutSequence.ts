import type {
  SequenceArrowHead,
  SequenceFragment,
  SequenceFragmentKind,
  SequenceLineStyle,
  SequenceModel,
  SequenceNote,
  SequenceStep,
} from "./sequenceModel.ts";
import {
  DIAGRAM_FONT_SIZE,
  DIAGRAM_LINE_HEIGHT,
  measureLabel,
} from "./textMetrics.ts";

/**
 * The largest diagram that gets laid out. Above either cap the caller falls
 * back to the code block.
 *
 * Unlike the flowchart caps these are NOT about time: layout here is O(n)
 * arithmetic with no ranking to compute, and 300 rows lay out in under a
 * millisecond. They are about legibility and DOM size - 30 lifelines is
 * already far past what anyone can read, and every row is a handful of SVG
 * elements on a page that may carry several diagrams.
 *
 * `MAX_SEQUENCE_MESSAGES` counts ROWS, notes included: a note occupies a
 * row and costs a box, so counting only messages would let a note-heavy
 * diagram past the cap it exists to enforce.
 */
export const MAX_SEQUENCE_PARTICIPANTS = 30;
export const MAX_SEQUENCE_MESSAGES = 300;

/**
 * The safety margin applied to the width a label needs in the gap between
 * two lifelines. **Gap constraints only** - not participant boxes, which
 * stay tight, and not note boxes, which carry their own padding.
 *
 * ## Why a margin exists here and nowhere else
 *
 * `textMetrics.ts` measures text from a generated per-character width table
 * rather than from the DOM, which is what keeps this a pure function. The
 * table was measured against `canvas.measureText` on the real Inter woff2
 * and agrees **within ~1.3%**, all of it from rounding the ratios to three
 * decimals.
 *
 * The asymmetry is what makes the margin necessary at all. A flowchart
 * label sits INSIDE its box, so a 1.3% underestimate only eats padding. A
 * sequence label sits IN THE GAP between two lifelines, so the same
 * underestimate puts text on top of the neighbouring lifeline. 4% is three
 * times the measured error.
 *
 * Do not "optimise" this away as a magic number: it is a measured 1.3% with
 * headroom, and removing it makes long labels collide.
 */
export const GAP_LABEL_MARGIN = 1.04;

const DIAGRAM_PADDING = 12;
const PARTICIPANT_PAD_X = 14;
const PARTICIPANT_PAD_Y = 8;
const PARTICIPANT_MIN_WIDTH = 64;
/**
 * Clear space between two adjacent participant boxes, before any label
 * widens the gap.
 */
const PARTICIPANT_CLEARANCE = 26;
/**
 * The stick figure an `actor` draws above its name.
 */
const ACTOR_FIGURE_HEIGHT = 32;
const ACTOR_LABEL_GAP = 4;
const ACTOR_MIN_WIDTH = 40;

const LIFELINE_TOP_GAP = 14;
const LIFELINE_BOTTOM_GAP = 14;

const MESSAGE_LABEL_GAP = 4;
const MESSAGE_ROW_GAP = 16;
/**
 * Clearance between a message label and each lifeline it is centred
 * between.
 */
const MESSAGE_LABEL_GUTTER = 10;

const SELF_LOOP_WIDTH = 32;
const SELF_LOOP_LABEL_GAP = 8;
const SELF_LOOP_MIN_HEIGHT = 26;
const SELF_LOOP_TOP_PAD = 4;

const NOTE_PAD_X = 10;
const NOTE_PAD_Y = 7;
const NOTE_ROW_GAP = 14;
/**
 * How far a `Note over A,B` reaches past the two lifelines it spans.
 */
const NOTE_SPAN_OVERHANG = 10;
/**
 * Clearance between a note box and any lifeline it is not attached to.
 */
const NOTE_CLEARANCE = 10;

const FRAGMENT_INSET = 9;
/**
 * How far a depth-0 fragment box reaches past the widest content.
 */
const FRAGMENT_MARGIN = 14;
const FRAGMENT_TAB_PAD_X = 8;
const FRAGMENT_TAB_PAD_Y = 3;
const FRAGMENT_TOP_PAD = 8;
const FRAGMENT_BOTTOM_PAD = 10;
const FRAGMENT_AFTER_GAP = 6;
const FRAGMENT_MIN_WIDTH = 60;
const DIVIDER_GAP = 8;

export interface PositionedParticipant {
  id: string;
  /**
   * The lines as MEASURED - wrapped and capped. Draw exactly these.
   */
  lines: string[];
  actor: boolean;
  /**
   * TOP-LEFT corner of the header box, the same convention the flowchart
   * layout settled on. An emitter half a box off looks almost right, which
   * is the worst way for this to be wrong.
   */
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * Where the lifeline runs. `centerX` is the lifeline's x, and the box is
   * centred on it.
   */
  centerX: number;
  lifelineTop: number;
  lifelineBottom: number;
  /**
   * TOP-LEFT y of the repeated footer box. Its `x`, `width` and `height`
   * are the header's.
   */
  bottomY: number;
}

export interface PositionedLabel {
  lines: string[];
  /**
   * TOP-LEFT corner.
   */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PositionedMessage {
  from: string;
  to: string;
  line: SequenceLineStyle;
  head: SequenceArrowHead;
  self: boolean;
  /**
   * Two points for a normal message, four for the loop of a self-message.
   * In from-to order, so the head marker lands on the receiver.
   */
  points: Array<{ x: number; y: number }>;
  /**
   * Already carries the `autonumber` counter when the diagram declared one.
   */
  label: PositionedLabel;
}

export interface PositionedNoteBox extends PositionedLabel {
  placement: SequenceNote["placement"];
}

export interface PositionedFragment {
  kind: SequenceFragmentKind;
  /**
   * The condition, drawn next to the tab. May be empty.
   */
  label: string;
  depth: number;
  /**
   * TOP-LEFT corner of the box.
   */
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * The corner tab carrying the kind (`alt`, `opt`, `loop`).
   */
  tabWidth: number;
  tabHeight: number;
  dividers: Array<{ y: number; label: string }>;
}

/**
 * A laid-out sequence diagram: data, not markup. No SVG, no React, no DOM.
 */
export interface PositionedSequence {
  width: number;
  height: number;
  fontSize: number;
  participants: PositionedParticipant[];
  messages: PositionedMessage[];
  notes: PositionedNoteBox[];
  /**
   * Outermost first, so the emitter draws them in order and gets z-order
   * free, the way the flowchart clusters do.
   */
  fragments: PositionedFragment[];
}

/**
 * Place a `SequenceModel` on a plane.
 *
 * **No layout library is involved, and none is coming back.** `graphre`
 * ranks a node graph; here both axes are already decided by the source -
 * participants left to right in declaration order, rows top to bottom in
 * statement order - so layout is arithmetic. The only genuinely hard part
 * is the column widths, which take two passes (see `columnCenters`).
 *
 * Returns `undefined` (never throws, never a partial diagram) for an empty
 * model or one past the caps. The caller's fallback is the code block.
 */
export const layoutSequence = (
  model: SequenceModel,
  fontSize: number = DIAGRAM_FONT_SIZE,
): PositionedSequence | undefined => {
  if (model.participants.length === 0 || model.steps.length === 0)
    return undefined;
  if (model.participants.length > MAX_SEQUENCE_PARTICIPANTS) return undefined;
  if (model.steps.length > MAX_SEQUENCE_MESSAGES) return undefined;

  const index = new Map(model.participants.map((p, i) => [p.id, i]));
  const heads = model.participants.map((participant) =>
    measureHead(participant.lines, participant.actor, fontSize),
  );
  // ⚠️ Numbering happens BEFORE anything is measured. The counter is part of
  // the label, so measuring first and numbering after makes every column
  // too narrow - and it stays invisible until a diagram reaches ten
  // messages and the labels go double-digit.
  const labels = measureSteps(model, fontSize);

  const centers = columnCenters(model, index, heads, labels);
  const headerHeight = Math.max(...heads.map((head) => head.height));

  const rows = layoutRows(model, index, centers, labels, {
    fontSize,
    top: DIAGRAM_PADDING + headerHeight + LIFELINE_TOP_GAP,
  });

  const participants = model.participants.map((participant, i) => ({
    id: participant.id,
    lines: heads[i].lines,
    actor: participant.actor,
    // Header boxes are bottom-aligned so every lifeline starts on the same
    // y, whatever mix of one-line names, wrapped names and actors is on the
    // row.
    x: centers[i] - heads[i].width / 2,
    y: DIAGRAM_PADDING + headerHeight - heads[i].height,
    width: heads[i].width,
    height: heads[i].height,
    centerX: centers[i],
    lifelineTop: DIAGRAM_PADDING + headerHeight,
    lifelineBottom: rows.bottom,
    bottomY: rows.bottom,
  }));

  const content = contentBounds(participants, rows);
  const fragments = layoutFragments(model, rows, content, fontSize);

  const minX = fragments.length ? content.minX - FRAGMENT_MARGIN : content.minX;
  const maxX = fragments.length ? content.maxX + FRAGMENT_MARGIN : content.maxX;
  const dx = DIAGRAM_PADDING - minX;

  return {
    width: maxX - minX + DIAGRAM_PADDING * 2,
    height: rows.bottom + headerHeight + DIAGRAM_PADDING,
    fontSize,
    participants: participants.map((participant) => ({
      ...participant,
      x: participant.x + dx,
      centerX: participant.centerX + dx,
    })),
    messages: rows.messages.map((message) => ({
      ...message,
      points: message.points.map((point) => ({ x: point.x + dx, y: point.y })),
      label: { ...message.label, x: message.label.x + dx },
    })),
    notes: rows.notes.map((note) => ({ ...note, x: note.x + dx })),
    fragments: fragments.map((fragment) => ({
      ...fragment,
      x: fragment.x + dx,
    })),
  };
};

interface Measured {
  width: number;
  height: number;
  lines: string[];
}

/**
 * The header box of one participant. An `actor` is a stick figure with its
 * name underneath rather than a box around it, so it is taller and needs no
 * horizontal padding.
 */
const measureHead = (
  lines: string[],
  actor: boolean,
  fontSize: number,
): Measured => {
  const label = measureLabel(lines, fontSize);
  if (actor)
    return {
      width: Math.max(label.width, ACTOR_MIN_WIDTH),
      height: ACTOR_FIGURE_HEIGHT + ACTOR_LABEL_GAP + label.height,
      lines: label.lines,
    };
  return {
    width: Math.max(label.width + PARTICIPANT_PAD_X * 2, PARTICIPANT_MIN_WIDTH),
    height: label.height + PARTICIPANT_PAD_Y * 2,
    lines: label.lines,
  };
};

/**
 * Measure every row's label once, applying `autonumber` first.
 *
 * A note's measurement is its BOX (label plus padding); a message's is its
 * bare label, because a message label is drawn straight onto the diagram.
 */
const measureSteps = (model: SequenceModel, fontSize: number): Measured[] => {
  let counter = model.autonumber?.start ?? 0;
  return model.steps.map((step) => {
    if (step.kind === "note") {
      const label = measureLabel(step.lines, fontSize);
      return {
        width: label.width + NOTE_PAD_X * 2,
        height: label.height + NOTE_PAD_Y * 2,
        lines: label.lines,
      };
    }
    if (!model.autonumber) return measureLabel(step.lines, fontSize);

    const number = counter;
    counter += model.autonumber.step;
    const [first, ...rest] = step.lines;
    return measureLabel(
      [first ? `${number}. ${first}` : `${number}`, ...rest],
      fontSize,
    );
  });
};

/**
 * Where each lifeline sits on the x axis, in two passes.
 *
 * **Pass one** gives every adjacent pair the room its two boxes need side
 * by side.
 *
 * **Pass two** walks every message and note and widens the span it covers
 * until its label fits. A label is centred over its whole span, so a
 * message from participant 1 to participant 5 constrains the sum of four
 * gaps rather than any one of them, and the shortfall is spread evenly
 * across the gaps it crosses. Gaps only ever grow, so one pass over the
 * constraints is enough: widening for a later label can never break an
 * earlier one.
 *
 * The centres come back starting at 0. The caller translates once, at the
 * end, after the true bounding box is known.
 */
const columnCenters = (
  model: SequenceModel,
  index: Map<string, number>,
  heads: Measured[],
  labels: Measured[],
): number[] => {
  const count = model.participants.length;
  const gaps: number[] = [];
  for (let i = 0; i < count - 1; i++)
    gaps.push(
      heads[i].width / 2 + heads[i + 1].width / 2 + PARTICIPANT_CLEARANCE,
    );

  const widen = (from: number, to: number, required: number): void => {
    // A constraint can legitimately point off the end of the row: a note to
    // the left of the FIRST lifeline has no gap to widen, and the space it
    // needs falls out of the final bounding box instead. Clamping here
    // rather than at each call site is what keeps those cases from reading
    // `gaps[-1]` and poisoning every later width with a NaN.
    if (to <= from || from < 0 || to > gaps.length) return;
    let current = 0;
    for (let i = from; i < to; i++) current += gaps[i];
    if (current >= required) return;
    const extra = (required - current) / (to - from);
    for (let i = from; i < to; i++) gaps[i] += extra;
  };

  for (const [at, step] of model.steps.entries()) {
    const label = labels[at];
    if (step.kind === "message") {
      const from = index.get(step.from);
      const to = index.get(step.to);
      if (from === undefined || to === undefined) continue;

      if (step.self) {
        // The loop hangs to the RIGHT of its lifeline with the label beyond
        // it, so it eats into one gap rather than spanning several. At the
        // last participant there is no gap to eat, and the clearance falls
        // out of the final bounding box instead.
        if (from >= count - 1) continue;
        widen(
          from,
          from + 1,
          SELF_LOOP_WIDTH +
            SELF_LOOP_LABEL_GAP +
            label.width * GAP_LABEL_MARGIN +
            MESSAGE_LABEL_GUTTER,
        );
        continue;
      }
      widen(
        Math.min(from, to),
        Math.max(from, to),
        label.width * GAP_LABEL_MARGIN + MESSAGE_LABEL_GUTTER * 2,
      );
      continue;
    }

    const anchors = step.participants
      .map((id) => index.get(id))
      .filter((at): at is number => at !== undefined);
    if (anchors.length === 0) continue;

    if (step.placement === "over" && anchors.length > 1) {
      const from = Math.min(...anchors);
      const to = Math.max(...anchors);
      // A note box carries its own padding, so no margin is applied to it -
      // it is not text sitting in a gap.
      widen(from, to, label.width - NOTE_SPAN_OVERHANG * 2);
      continue;
    }

    const anchor = anchors[0];
    if (step.placement === "over") {
      // Centred on one lifeline, so it eats half its width into each
      // neighbouring gap.
      widen(anchor - 1, anchor, label.width / 2 + NOTE_CLEARANCE);
      widen(anchor, anchor + 1, label.width / 2 + NOTE_CLEARANCE);
      continue;
    }
    if (step.placement === "left")
      widen(anchor - 1, anchor, label.width + NOTE_CLEARANCE * 2);
    else widen(anchor, anchor + 1, label.width + NOTE_CLEARANCE * 2);
  }

  const centers = [0];
  for (const gap of gaps) centers.push(centers[centers.length - 1] + gap);
  return centers;
};

interface RowContext {
  fontSize: number;
  top: number;
}

interface Rows {
  messages: PositionedMessage[];
  notes: PositionedNoteBox[];
  /**
   * y where every lifeline stops, and the footer boxes start.
   */
  bottom: number;
  /**
   * Per fragment, the box top and bottom and each divider's y, keyed by the
   * fragment's position in `model.fragments`.
   */
  spans: Map<number, { top: number; bottom: number; dividers: number[] }>;
}

/**
 * One sequential pass down the rows, assigning y.
 *
 * This is the whole reason the model is flat: a nested tree would force
 * this to recurse while threading the cursor through it, and a fragment box
 * would still have to be min/max over the rows it turned out to contain.
 */
const layoutRows = (
  model: SequenceModel,
  index: Map<string, number>,
  centers: number[],
  labels: Measured[],
  context: RowContext,
): Rows => {
  const messages: PositionedMessage[] = [];
  const notes: PositionedNoteBox[] = [];
  const spans = new Map<
    number,
    { top: number; bottom: number; dividers: number[] }
  >();
  const tabHeight =
    context.fontSize * DIAGRAM_LINE_HEIGHT + FRAGMENT_TAB_PAD_Y * 2;

  // Outermost first on the way in, innermost first on the way out, so a
  // nested box always sits strictly inside the one that contains it.
  const opening = byStep(model, (fragment) => fragment.from, 1);
  const closing = byStep(model, (fragment) => fragment.to, -1);
  const dividing = dividersByStep(model);

  let y = context.top;

  for (const [at, step] of model.steps.entries()) {
    for (const owner of opening.get(at) ?? []) {
      spans.set(owner, { top: y, bottom: y, dividers: [] });
      y += tabHeight + FRAGMENT_TOP_PAD;
    }
    for (const owner of dividing.get(at) ?? []) {
      const span = spans.get(owner);
      if (!span) continue;
      y += DIVIDER_GAP;
      span.dividers.push(y);
      // The `else` condition is drawn BELOW its divider, because that is
      // the branch it names, so the room for it goes below too.
      y += context.fontSize * DIAGRAM_LINE_HEIGHT + DIVIDER_GAP;
    }

    const label = labels[at];
    y =
      step.kind === "note"
        ? placeNote(step, label, index, centers, y, notes)
        : placeMessage(step, label, index, centers, y, messages);

    for (const owner of closing.get(at) ?? []) {
      const span = spans.get(owner);
      if (!span) continue;
      y += FRAGMENT_BOTTOM_PAD;
      span.bottom = y;
      y += FRAGMENT_AFTER_GAP;
    }
  }

  return { messages, notes, bottom: y + LIFELINE_BOTTOM_GAP, spans };
};

/**
 * Fragment indices grouped by the step they open or close at, sorted so
 * outer fragments come first on the way in and last on the way out.
 */
const byStep = (
  model: SequenceModel,
  pick: (fragment: SequenceFragment) => number,
  order: 1 | -1,
): Map<number, number[]> => {
  const out = new Map<number, number[]>();
  for (const [at, fragment] of model.fragments.entries())
    push(out, pick(fragment), at);
  for (const list of out.values())
    list.sort(
      (a, b) => (model.fragments[a].depth - model.fragments[b].depth) * order,
    );
  return out;
};

/**
 * Which fragments have an `else` at each step, outermost first: a divider
 * belonging to an outer box has to be drawn above one belonging to a box
 * nested inside it, or the two branches read as swapped.
 */
const dividersByStep = (model: SequenceModel): Map<number, number[]> => {
  const out = new Map<number, number[]>();
  for (const [at, fragment] of model.fragments.entries())
    for (const divider of fragment.dividers) push(out, divider.at, at);
  for (const list of out.values())
    list.sort((a, b) => model.fragments[a].depth - model.fragments[b].depth);
  return out;
};

const push = (map: Map<number, number[]>, key: number, value: number): void => {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
};

const placeMessage = (
  step: Extract<SequenceStep, { kind: "message" }>,
  label: Measured,
  index: Map<string, number>,
  centers: number[],
  y: number,
  out: PositionedMessage[],
): number => {
  const from = index.get(step.from);
  const to = index.get(step.to);
  if (from === undefined || to === undefined) return y;

  if (step.self) {
    const height = Math.max(SELF_LOOP_MIN_HEIGHT, label.height + 6);
    const top = y + SELF_LOOP_TOP_PAD;
    const bottom = top + height;
    const x = centers[from];
    out.push({
      from: step.from,
      to: step.to,
      line: step.line,
      head: step.head,
      self: true,
      points: [
        { x, y: top },
        { x: x + SELF_LOOP_WIDTH, y: top },
        { x: x + SELF_LOOP_WIDTH, y: bottom },
        { x, y: bottom },
      ],
      label: {
        lines: label.lines,
        x: x + SELF_LOOP_WIDTH + SELF_LOOP_LABEL_GAP,
        y: (top + bottom) / 2 - label.height / 2,
        width: label.width,
        height: label.height,
      },
    });
    return bottom + MESSAGE_ROW_GAP;
  }

  const lineY = y + label.height + MESSAGE_LABEL_GAP;
  out.push({
    from: step.from,
    to: step.to,
    line: step.line,
    head: step.head,
    self: false,
    points: [
      { x: centers[from], y: lineY },
      { x: centers[to], y: lineY },
    ],
    label: {
      lines: label.lines,
      x: (centers[from] + centers[to]) / 2 - label.width / 2,
      y,
      width: label.width,
      height: label.height,
    },
  });
  return lineY + MESSAGE_ROW_GAP;
};

const placeNote = (
  step: SequenceNote,
  label: Measured,
  index: Map<string, number>,
  centers: number[],
  y: number,
  out: PositionedNoteBox[],
): number => {
  const anchors = step.participants
    .map((id) => index.get(id))
    .filter((at): at is number => at !== undefined);
  if (anchors.length === 0) return y;

  const from = Math.min(...anchors);
  const to = Math.max(...anchors);
  const width =
    step.placement === "over" && to > from
      ? Math.max(
          label.width,
          centers[to] - centers[from] + NOTE_SPAN_OVERHANG * 2,
        )
      : label.width;

  const x =
    step.placement === "left"
      ? centers[from] - NOTE_CLEARANCE - width
      : step.placement === "right"
        ? centers[from] + NOTE_CLEARANCE
        : (centers[from] + centers[to]) / 2 - width / 2;

  out.push({
    placement: step.placement,
    lines: label.lines,
    x,
    y,
    width,
    height: label.height,
  });
  return y + label.height + NOTE_ROW_GAP;
};

interface Bounds {
  minX: number;
  maxX: number;
}

/**
 * The x extent of everything except the fragment boxes, which are sized
 * FROM it. A note hanging off the first lifeline and a self-message looping
 * off the last one are the two things that reach past the participants.
 */
const contentBounds = (
  participants: PositionedParticipant[],
  rows: Rows,
): Bounds => {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  const cover = (from: number, to: number) => {
    minX = Math.min(minX, from);
    maxX = Math.max(maxX, to);
  };

  for (const participant of participants)
    cover(participant.x, participant.x + participant.width);
  for (const note of rows.notes) cover(note.x, note.x + note.width);
  for (const message of rows.messages) {
    for (const point of message.points) cover(point.x, point.x);
    cover(message.label.x, message.label.x + message.label.width);
  }
  return { minX, maxX };
};

/**
 * Fragment boxes span the whole diagram, inset by depth, exactly as mermaid
 * draws them. Fitting a box to only the participants it happens to mention
 * was considered and dropped: a box that changes width with its contents
 * reads as a shape rather than as a scope.
 */
const layoutFragments = (
  model: SequenceModel,
  rows: Rows,
  content: Bounds,
  fontSize: number,
): PositionedFragment[] =>
  model.fragments
    .map((fragment, at) => {
      const span = rows.spans.get(at);
      if (!span) return undefined;
      const x =
        content.minX - FRAGMENT_MARGIN + fragment.depth * FRAGMENT_INSET;
      const right =
        content.maxX + FRAGMENT_MARGIN - fragment.depth * FRAGMENT_INSET;
      const label = measureLabel([fragment.kind], fontSize);
      return {
        kind: fragment.kind,
        label: fragment.label,
        depth: fragment.depth,
        x,
        y: span.top,
        width: Math.max(right - x, FRAGMENT_MIN_WIDTH),
        height: span.bottom - span.top,
        tabWidth: label.width + FRAGMENT_TAB_PAD_X * 2,
        tabHeight: label.height + FRAGMENT_TAB_PAD_Y * 2,
        dividers: fragment.dividers.map((divider, i) => ({
          y: span.dividers[i] ?? span.top,
          label: divider.label,
        })),
      };
    })
    .filter(
      (fragment): fragment is PositionedFragment => fragment !== undefined,
    )
    // Order IS z-order in SVG, so the outermost box goes down first and a
    // nested one draws on top of it, with no z-index anywhere.
    .sort((a, b) => a.depth - b.depth);
