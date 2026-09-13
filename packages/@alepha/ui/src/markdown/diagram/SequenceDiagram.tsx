import * as React from "react";

void React;

import { useId } from "react";

import { round } from "./DiagramLabel.tsx";
import type { PositionedSequence } from "./layoutSequence.ts";
import { SequenceDiagramFragment } from "./SequenceDiagramFragment.tsx";
import { SequenceDiagramMessage } from "./SequenceDiagramMessage.tsx";
import { SequenceDiagramNote } from "./SequenceDiagramNote.tsx";
import { SequenceDiagramParticipant } from "./SequenceDiagramParticipant.tsx";
import { DIAGRAM_FONT_FAMILY } from "./textMetrics.ts";

export interface SequenceDiagramProps {
  diagram: PositionedSequence;
  /**
   * Read out to assistive technology as the diagram's name.
   */
  title?: string;
}

/**
 * Draw a laid-out sequence diagram as themed SVG.
 *
 * Everything the flowchart emitter settled applies here unchanged, and none
 * of it is optional:
 *
 * ## React elements, not an HTML string
 *
 * `markdown-view.tsx` carries an explicit rule that no raw HTML is ever
 * promoted to markup, because it renders one user's content to another.
 * Emitting elements means labels are escaped by React itself and
 * `dangerouslySetInnerHTML` never appears on this path.
 *
 * ## Theming is the point
 *
 * Colours come from `--primary`, `--border`, `--muted-foreground`, `--card`
 * and `--muted` through `var(...)`, so dark mode works with no second
 * palette and no theme prop. That is the thing mermaid can structurally
 * never give us, and the whole reason drawing is our own code.
 *
 * ## The font is pinned, never inherited
 *
 * Folio view mode sets prose in Literata at 16.5px and lazy-loads it. The
 * width table is generated against Inter at `DIAGRAM_FONT_SIZE`, so
 * inheriting would make text and box disagree per surface and shift when
 * the serif lands. `fontFamily` / `fontSize` are camelCase, not the
 * hyphenated spelling: React renders the same SVG presentation attributes
 * either way, but hyphenated logs `Invalid DOM property` on every render,
 * from a component mounted on every markdown surface in the app.
 *
 * ## Unlike a flowchart, the width is natural rather than fitted
 *
 * A flowchart is roughly as tall as it is wide and scales into the prose
 * column. A sequence diagram's width is driven by participant count with
 * nothing to wrap, so scaling eight participants into a phone column puts
 * the labels at around 5px with no way for the reader to recover. So the
 * SVG takes its natural width and this component frames it in a scroll
 * container, with the keyboard affordances that come with one.
 */
export const SequenceDiagram = (props: SequenceDiagramProps) => {
  const diagram = props.diagram;
  // SVG marker ids are global to the DOCUMENT: two diagrams on one page
  // with the same arrowhead id fight, and the loser's arrows vanish.
  const scope = useId().replace(/[^\w-]/g, "");
  const title = props.title ?? "Sequence diagram";

  return (
    <div
      // `tabIndex` and `role` are the a11y requirement, not decoration: a
      // scrollable region that cannot be focused cannot be scrolled from a
      // keyboard at all, so the part of the diagram past the fold would be
      // unreachable. The named region is what gives it an accessible name
      // to announce when focus lands there.
      //
      // This reopens the "no interactivity" line the design drew, scoped to
      // scrolling and nothing else. Pan, zoom and click-through stay out.
      className="alepha-diagram-scroll my-4"
      // A scrollable region is the documented exception to
      // `no-noninteractive-tabindex`: WAI's own guidance is `tabindex="0"`
      // plus a named `region`, because without focus the content past the
      // fold cannot be reached by keyboard at all. The rule's allowlist
      // covers `tabpanel` and not `region`, which is what it is flagging.
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex
      tabIndex={0}
      role="region"
      aria-label={title}
    >
      <svg
        role="img"
        viewBox={`0 0 ${round(diagram.width)} ${round(diagram.height)}`}
        width={round(diagram.width)}
        height={round(diagram.height)}
        className="block"
        fontFamily={DIAGRAM_FONT_FAMILY}
        fontSize={diagram.fontSize}
        xmlns="http://www.w3.org/2000/svg"
      >
        <title>{title}</title>
        <defs>
          {/*
            THREE head kinds, not one. Epic #5 shipped a single end marker,
            which is exactly why `--o` and `--x` silently draw the same
            arrowhead as `-->` in a flowchart. Here `->>`, `-x` and `-)` are
            three different statements about a message and each gets its own.

            `context-stroke` throughout, never `currentColor`: a marker lives
            in `<defs>`, so `currentColor` resolves against the MARKER's
            inherited colour rather than the referencing line's - the head
            came out `--foreground` while its line was `--muted-foreground`,
            and in a differently-themed container it was wrong outright.
          */}
          <marker
            id={`${scope}-seq-arrow`}
            markerWidth="9"
            markerHeight="7"
            refX="8.5"
            refY="3.5"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path d="M0,0 L9,3.5 L0,7 z" fill="context-stroke" />
          </marker>
          <marker
            id={`${scope}-seq-open`}
            markerWidth="10"
            markerHeight="8"
            refX="9"
            refY="4"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            {/* The async form: an open V rather than a filled head. */}
            <path
              d="M1,0.5 L9,4 L1,7.5"
              fill="none"
              stroke="context-stroke"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </marker>
          <marker
            id={`${scope}-seq-cross`}
            markerWidth="9"
            markerHeight="9"
            refX="8"
            refY="4.5"
            orient="auto"
            markerUnits="userSpaceOnUse"
          >
            <path
              d="M1.5,1.5 L7.5,7.5 M7.5,1.5 L1.5,7.5"
              fill="none"
              stroke="context-stroke"
              strokeWidth="1.4"
              strokeLinecap="round"
            />
          </marker>
        </defs>

        {/*
          Order IS z-order in SVG. Fragment boxes go down first (they are
          outlines, and the outermost is first in the list), then the
          lifelines, then the messages, and notes last because a note is an
          opaque box that has to cover the lifeline it sits on.
        */}
        {diagram.fragments.map((fragment, index) => (
          <SequenceDiagramFragment
            key={`${fragment.kind}@${fragment.depth}#${index}`}
            fragment={fragment}
            fontSize={diagram.fontSize}
          />
        ))}
        {diagram.participants.map((participant) => (
          <SequenceDiagramParticipant
            key={participant.id}
            participant={participant}
            fontSize={diagram.fontSize}
          />
        ))}
        {diagram.messages.map((message, index) => (
          <SequenceDiagramMessage
            key={`${message.from}->${message.to}#${index}`}
            message={message}
            scope={scope}
            fontSize={diagram.fontSize}
          />
        ))}
        {diagram.notes.map((note, index) => (
          <SequenceDiagramNote
            // Notes are positional and their text may legitimately repeat, so
            // the index is the identity here.
            key={`note#${index}`}
            note={note}
            fontSize={diagram.fontSize}
          />
        ))}
      </svg>
    </div>
  );
};
