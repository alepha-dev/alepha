import * as React from "react";

void React;

import { DiagramLabel, round } from "./DiagramLabel.tsx";
import type { PositionedParticipant } from "./layoutSequence.ts";
import { SequenceDiagramParticipantActor } from "./SequenceDiagramParticipantActor.tsx";

export interface SequenceDiagramParticipantProps {
  participant: PositionedParticipant;
  fontSize: number;
}

/**
 * One lifeline, with its header and footer.
 *
 * The header is repeated at the bottom, as mermaid does: a forty-message
 * diagram is unreadable when the only thing naming the columns has scrolled
 * off the top.
 *
 * A participant declared with `actor` draws a stick figure rather than a
 * box. The parser keeps the two apart precisely so this component can, and
 * the distinction carries real meaning in a protocol diagram - a person and
 * a worker are not the same kind of thing.
 */
export const SequenceDiagramParticipant = (
  props: SequenceDiagramParticipantProps,
) => {
  const participant = props.participant;
  const x = round(participant.x);
  const width = round(participant.width);
  const centerX = round(participant.centerX);

  return (
    <g data-participant={participant.id}>
      <line
        x1={centerX}
        y1={round(participant.lifelineTop)}
        x2={centerX}
        y2={round(participant.lifelineBottom)}
        stroke="var(--border)"
        strokeWidth={1.25}
        strokeDasharray="4 4"
      />
      {[participant.y, participant.bottomY].map((top) =>
        participant.actor ? (
          <SequenceDiagramParticipantActor
            key={`actor@${round(top)}`}
            centerX={participant.centerX}
            top={top}
            lines={participant.lines}
            height={participant.height}
            fontSize={props.fontSize}
          />
        ) : (
          <g key={`box@${round(top)}`}>
            <rect
              x={x}
              y={round(top)}
              width={width}
              height={round(participant.height)}
              rx={5}
              ry={5}
              fill="var(--card)"
              stroke="var(--border)"
              strokeWidth={1.25}
            />
            <DiagramLabel
              lines={participant.lines}
              centerX={participant.centerX}
              centerY={top + participant.height / 2}
              fontSize={props.fontSize}
              fill="var(--card-foreground)"
            />
          </g>
        ),
      )}
    </g>
  );
};
