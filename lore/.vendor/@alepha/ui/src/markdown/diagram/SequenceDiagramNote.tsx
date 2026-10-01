import * as React from "react";

void React;

import { DiagramLabel, round } from "./DiagramLabel.tsx";
import type { PositionedNoteBox } from "./layoutSequence.ts";

export interface SequenceDiagramNoteProps {
  note: PositionedNoteBox;
  fontSize: number;
}

/**
 * An annotation box with its text wrapped inside it.
 *
 * Filled in `--muted` rather than mermaid's yellow: the theme picks the
 * colours here, which is the whole reason this renderer is our own code.
 * The fill has to be opaque - a note sits ON a lifeline and has to cover
 * it, which is why notes are drawn last of all.
 */
export const SequenceDiagramNote = (props: SequenceDiagramNoteProps) => {
  const note = props.note;

  return (
    <g data-note={note.placement}>
      <rect
        x={round(note.x)}
        y={round(note.y)}
        width={round(note.width)}
        height={round(note.height)}
        rx={4}
        ry={4}
        fill="var(--muted)"
        stroke="var(--border)"
        strokeWidth={1.25}
      />
      <DiagramLabel
        lines={note.lines}
        centerX={note.x + note.width / 2}
        centerY={note.y + note.height / 2}
        fontSize={props.fontSize}
        fill="var(--muted-foreground)"
      />
    </g>
  );
};
