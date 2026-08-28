import type {
  SequenceArrowHead,
  SequenceFragment,
  SequenceFragmentKind,
  SequenceModel,
  SequenceNote,
  SequenceParticipant,
  SequenceStep,
} from "./sequenceModel.ts";

/**
 * Parse the text inside a ` ```mermaid ` fence into a `SequenceModel`.
 *
 * Pure string in, data out: no layout knowledge, no DOM, no React. The
 * subset is mermaid's `sequenceDiagram` as agents actually write it -
 * participants and actors, the eight arrow forms, notes, `autonumber`,
 * self-messages, and the `alt` / `else` / `opt` / `loop` fragment boxes.
 *
 * **It never throws.** The caller's fallback is the original code block, so
 * anything unreadable returns `undefined` and degrades to the grey fence.
 *
 * ## Refuse vs skip, and why the line is where it is
 *
 * The test is whether dropping the construct would LIE about the diagram.
 *
 * - `par`, `critical`, `break`, `create`, `destroy` **refuse the whole
 *   diagram**. Drawing `par` branches one under the other asserts an
 *   ordering that is false, and silently wrong output is worse than no
 *   output.
 * - `rect`, `box`, `links`, `link`, `menu`, `style`, `activate` /
 *   `deactivate` are **skipped in silence**: decorative, or (for the
 *   activation pair) out of the v1 subset, and nothing semantic is lost.
 *
 * Structurally malformed input - an `end` with nothing open, a fragment
 * never closed, an `else` outside an `alt`, a `Note over` naming a
 * participant that appears nowhere - refuses the diagram too. Unlike the
 * flowchart parser, a statement is NOT degraded on its own here: a lost
 * message in the middle of a protocol is a wrong protocol.
 */
export const parseSequence = (source: string): SequenceModel | undefined => {
  try {
    return parseChecked(source);
  } catch {
    // A parser bug, or a deliberate refusal, must cost the diagram and
    // never the page it sits on.
    return undefined;
  }
};

const parseChecked = (source: string): SequenceModel | undefined => {
  const statements = splitStatements(stripPreamble(source));
  if (statements.length === 0) return undefined;
  if (!/^sequenceDiagram\s*$/i.test(statements[0])) return undefined;

  const state: ParseState = {
    participants: new Map(),
    steps: [],
    fragments: [],
    stack: [],
    notes: [],
  };

  for (const statement of statements.slice(1)) {
    readStatement(statement, state);
  }

  // A fragment left open is malformed: its box would have no bottom, and
  // guessing one invents structure the author did not write.
  if (state.stack.length > 0) return undefined;

  // Notes do NOT declare participants - a note is an annotation, and one
  // pinned to a name that appears nowhere else is a typo, not a lifeline.
  // Resolved here rather than at the statement, because the participant may
  // legitimately be declared by a LATER message.
  for (const note of state.notes) {
    for (const id of note.participants) {
      if (!state.participants.has(id)) return undefined;
    }
  }

  if (state.participants.size === 0 || state.steps.length === 0)
    return undefined;

  return {
    participants: [...state.participants.values()],
    steps: state.steps,
    fragments: collectFragments(state),
    ...(state.autonumber ? { autonumber: state.autonumber } : {}),
  };
};

interface OpenFragment {
  /**
   * Undefined for a `rect` / `box` block, which is skipped but still has to
   * consume its own `end` - without this the `end` would look like a
   * dangling one and refuse the whole diagram.
   */
  fragment?: SequenceFragment;
  kind: SequenceFragmentKind | "transparent";
}

interface ParseState {
  participants: Map<string, SequenceParticipant>;
  steps: SequenceStep[];
  fragments: SequenceFragment[];
  /**
   * Open blocks, innermost last.
   */
  stack: OpenFragment[];
  /**
   * Every note, kept aside so its participants can be checked once the
   * whole diagram has been read.
   */
  notes: SequenceNote[];
  autonumber?: { start: number; step: number };
}

/**
 * Blocks whose meaning cannot survive being drawn in the v1 subset. Hitting
 * one refuses the whole diagram.
 */
const REFUSED = /^(?:par|critical|break|create|destroy)\b/i;

/**
 * Statements that carry decoration, grouping or interaction rather than
 * protocol. `activate` / `deactivate` are here because activation bars are
 * cut from v1 and dropping a bar loses nothing semantic.
 *
 * `rect` and `box` are NOT here: they open a block terminated by `end`, so
 * they are pushed onto the stack as transparent and skipped there.
 */
const SKIPPED =
  /^(?:links?|menu|style|activate|deactivate|and|option|title|accTitle|accDescr|properties|details)\b/i;

const readStatement = (statement: string, state: ParseState): void => {
  if (!statement) return;

  if (/^end$/i.test(statement)) {
    closeBlock(state);
    return;
  }
  if (REFUSED.test(statement)) throw new Error("unsupported construct");
  if (SKIPPED.test(statement)) return;

  // `rect rgb(0,0,0)` and `box Aqua Group` are both blocks: skipping the
  // opener alone would leave their `end` dangling.
  if (/^(?:rect|box)\b/i.test(statement)) {
    state.stack.push({ kind: "transparent" });
    return;
  }

  const fragment = /^(alt|opt|loop)\b\s*(.*)$/i.exec(statement);
  if (fragment) {
    openFragment(
      fragment[1].toLowerCase() as SequenceFragmentKind,
      fragment[2].trim(),
      state,
    );
    return;
  }

  const divider = /^else\b\s*(.*)$/i.exec(statement);
  if (divider) {
    addDivider(divider[1].trim(), state);
    return;
  }

  const participant = /^(participant|actor)\s+(.+)$/i.exec(statement);
  if (participant) {
    declareParticipant(
      participant[2].trim(),
      participant[1].toLowerCase() === "actor",
      state,
    );
    return;
  }

  const autonumber = /^autonumber\b\s*(.*)$/i.exec(statement);
  if (autonumber) {
    readAutonumber(autonumber[1].trim(), state);
    return;
  }

  if (/^note\b/i.test(statement)) {
    readNote(statement, state);
    return;
  }

  readMessage(statement, state);
};

const openFragment = (
  kind: SequenceFragmentKind,
  label: string,
  state: ParseState,
): void => {
  const fragment: SequenceFragment = {
    kind,
    label: unquote(label),
    from: state.steps.length,
    // Patched by `closeBlock`. A fragment that never gets one refuses the
    // diagram, so this value is never read.
    to: -1,
    depth: state.stack.filter((open) => open.fragment).length,
    dividers: [],
  };
  state.fragments.push(fragment);
  state.stack.push({ fragment, kind });
};

const addDivider = (label: string, state: ParseState): void => {
  const open = state.stack[state.stack.length - 1];
  // `else` belongs to `alt` and nothing else. Inside an `opt` or a `loop`
  // it is not a branch, it is a mistake.
  if (!open?.fragment || open.kind !== "alt")
    throw new Error("else outside an alt");
  open.fragment.dividers.push({
    at: state.steps.length,
    label: unquote(label),
  });
};

const closeBlock = (state: ParseState): void => {
  const open = state.stack.pop();
  // An `end` with nothing open means the author's nesting does not close,
  // so every box below it would be drawn around the wrong rows.
  if (!open) throw new Error("unbalanced end");
  if (open.fragment) open.fragment.to = state.steps.length - 1;
};

/**
 * Drop the fragments that turned out to enclose nothing, and the dividers
 * that turned out to introduce nothing.
 *
 * An `alt X` immediately followed by `end` is not malformed, it just says
 * nothing: a box around zero rows has no height and only clutters. Same for
 * a trailing `else` with no messages under it.
 *
 * ⚠️ A divider at exactly `from` is KEPT, not dropped as empty. It means the
 * first branch is the empty one, and dropping it would put every row of the
 * `else` branch under the `alt`'s own label - a box asserting that messages
 * happen in the branch that did not run. Drawn, it is a divider immediately
 * under the label tab, which is what the author wrote.
 */
const collectFragments = (state: ParseState): SequenceFragment[] =>
  state.fragments
    .filter((fragment) => fragment.to >= fragment.from)
    .map((fragment) => ({
      ...fragment,
      dividers: fragment.dividers.filter(
        (divider) => divider.at >= fragment.from && divider.at <= fragment.to,
      ),
    }));

/**
 * `participant A`, `participant A as Alice`, `actor A as Alice`.
 */
const declareParticipant = (
  rest: string,
  actor: boolean,
  state: ParseState,
): void => {
  const alias = /^(.*?)\s+as\s+(.*)$/i.exec(rest);
  const id = unquote((alias ? alias[1] : rest).trim());
  if (!id) return;
  const label = alias ? unquote(alias[2].trim()) : id;

  const existing = state.participants.get(id);
  if (existing) {
    // A late `participant A as Alice` after an implicit declaration still
    // names the lifeline; it just cannot move it, since column order is
    // first appearance.
    existing.lines = splitLabel(label);
    existing.actor = actor;
    return;
  }
  state.participants.set(id, { id, lines: splitLabel(label), actor });
};

/**
 * A participant named by a message exists from that moment on, in the
 * column position of its first appearance.
 */
const useParticipant = (id: string, state: ParseState): string => {
  if (!state.participants.has(id))
    state.participants.set(id, { id, lines: splitLabel(id), actor: false });
  return id;
};

const readAutonumber = (rest: string, state: ParseState): void => {
  if (/^off$/i.test(rest)) {
    state.autonumber = undefined;
    return;
  }
  const numbers = rest.split(/\s+/).filter(Boolean).map(Number);
  const start = Number.isFinite(numbers[0]) ? numbers[0] : 1;
  const step = Number.isFinite(numbers[1]) ? numbers[1] : 1;
  state.autonumber = { start, step };
};

/**
 * `Note left of A: text`, `Note right of A: text`, `Note over A: text`,
 * `Note over A,B: text`.
 */
const readNote = (statement: string, state: ParseState): void => {
  const colon = statement.indexOf(":");
  if (colon < 0) return;

  const head = /^note\s+(left\s+of|right\s+of|over)\s+(.+)$/i.exec(
    statement.slice(0, colon).trim(),
  );
  if (!head) return;

  const placement = /^left/i.test(head[1])
    ? "left"
    : /^right/i.test(head[1])
      ? "right"
      : "over";
  const ids = head[2]
    .split(",")
    .map((id) => unquote(id.trim()))
    .filter(Boolean)
    // `Note left of A,B` is not a thing; only `over` spans two lifelines.
    .slice(0, placement === "over" ? 2 : 1);
  if (ids.length === 0) return;

  const note: SequenceNote = {
    kind: "note",
    placement,
    participants: ids,
    lines: splitLabel(statement.slice(colon + 1).trim()),
  };
  state.steps.push(note);
  state.notes.push(note);
};

/**
 * Every arrow form in the subset, as `(dashes)(head)(activation)`.
 *
 * `--` is the dashed line and `-` the solid one; `>>` must precede `>` in
 * the alternation or `->>` reads as `->` followed by a stray `>`.
 */
const ARROW = /(--?)(>>|>|x|\))([+-]?)/g;

const HEADS: Record<string, SequenceArrowHead> = {
  ">>": "arrow",
  ">": "none",
  x: "cross",
  ")": "open",
};

/**
 * `A ->> B: label`.
 *
 * ## Split on the colon FIRST
 *
 * `A ->> B: label with -> inside` must not re-split on the arrow in its own
 * label. The flowchart parser has exactly this bug for node labels, it
 * fails silently, and the diagram still draws with the text cut in half.
 * Here the label is everything after the first `:` and the arrow is only
 * ever looked for on the left of it.
 *
 * ## Then take the first arrow that leaves two usable names
 *
 * A participant id may contain a hyphen (`my-service ->> db`), so the first
 * regex hit is not always the arrow: `my-x ->> B` matches `-x` at
 * `my-x`. Each candidate is therefore checked, and one that leaves a
 * name with a space in it (`y ->> B`) is not the arrow.
 */
const readMessage = (statement: string, state: ParseState): void => {
  const colon = statement.indexOf(":");
  if (colon < 0) return;
  const head = statement.slice(0, colon);

  ARROW.lastIndex = 0;
  for (let match = ARROW.exec(head); match; match = ARROW.exec(head)) {
    const from = head.slice(0, match.index).trim();
    const to = head.slice(match.index + match[0].length).trim();
    if (!isName(from) || !isName(to)) continue;

    const sender = useParticipant(unquote(from), state);
    const receiver = useParticipant(unquote(to), state);
    state.steps.push({
      kind: "message",
      from: sender,
      to: receiver,
      lines: splitLabel(statement.slice(colon + 1).trim()),
      line: match[1] === "--" ? "dashed" : "solid",
      head: HEADS[match[2]],
      self: sender === receiver,
    });
    return;
  }
};

const isName = (value: string): boolean =>
  value.length > 0 && !/\s/.test(value);

/**
 * Split a label on `<br/>`, in every spelling mermaid accepts.
 */
const splitLabel = (label: string): string[] => {
  const lines = unquote(label)
    .split(/<br\s*\/?>/i)
    .map((line) => line.trim());
  return lines.length > 0 ? lines : [""];
};

const unquote = (value: string): string => {
  const trimmed = value.trim();
  if (trimmed.length < 2) return trimmed;
  const first = trimmed[0];
  const last = trimmed[trimmed.length - 1];
  if ((first === '"' || first === "`") && first === last)
    return trimmed.slice(1, -1).trim();
  return trimmed;
};

/**
 * Drop the YAML frontmatter block and any `%%{init: …}%%` directives, both
 * of which mermaid allows above the header line.
 */
const stripPreamble = (source: string): string =>
  source
    .replace(/^\s*---\r?\n[\s\S]*?\r?\n---\r?\n/, "")
    .replace(/%%\{[\s\S]*?\}%%/g, "");

/**
 * One statement per line, `%%` comments dropped.
 *
 * Unlike the flowchart grammar there is no `;` terminator to worry about: a
 * sequence diagram is line-oriented, and a `;` inside a message label is
 * ordinary text.
 */
const splitStatements = (source: string): string[] =>
  source
    .split(/\r?\n/)
    .map((line) => line.replace(/%%.*$/, "").trim())
    .filter(Boolean);
