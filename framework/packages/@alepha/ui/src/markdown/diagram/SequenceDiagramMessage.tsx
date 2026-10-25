import * as React from "react";

void React;

import { DiagramLabel, round } from "./DiagramLabel.tsx";
import type { PositionedMessage } from "./layoutSequence.ts";

export interface SequenceDiagramMessageProps {
  message: PositionedMessage;
  /**
   * Instance-unique prefix for the arrowhead marker ids.
   */
  scope: string;
  fontSize: number;
}

/**
 * One message: its line, its head and its label.
 *
 * `currentColor` on the path is what makes the head match. A marker
 * inherits `context-stroke` from the element that references it, so one set
 * of three markers serves every message without a set per colour.
 *
 * The label sits on a `--background` chip. A message spanning several
 * lifelines draws its label over the ones in between, and without the chip
 * the dashes run straight through the text.
 */
export const SequenceDiagramMessage = (props: SequenceDiagramMessageProps) => {
  const message = props.message;

  return (
    <g style={{ color: "var(--muted-foreground)" }}>
      <path
        data-message={`${message.from}->${message.to}`}
        d={pathOf(message.points)}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.4}
        strokeDasharray={message.line === "dashed" ? "5 4" : undefined}
        strokeLinecap="round"
        strokeLinejoin="round"
        markerEnd={markerOf(message, props.scope)}
      />
      {message.label.lines.some(Boolean) ? (
        <>
          <rect
            x={round(message.label.x - 3)}
            y={round(message.label.y)}
            width={round(message.label.width + 6)}
            height={round(message.label.height)}
            rx={3}
            ry={3}
            fill="var(--background)"
          />
          <DiagramLabel
            lines={message.label.lines}
            centerX={message.label.x + message.label.width / 2}
            centerY={message.label.y + message.label.height / 2}
            fontSize={props.fontSize}
            fill="var(--foreground)"
          />
        </>
      ) : null}
    </g>
  );
};

/**
 * `->` and `-->` carry no head at all in mermaid, which is a real
 * distinction rather than a missing feature: an undecorated line is how a
 * plain call is written.
 */
const markerOf = (
  message: PositionedMessage,
  scope: string,
): string | undefined => {
  if (message.head === "none") return undefined;
  return `url(#${scope}-seq-${message.head})`;
};

/**
 * Two points for a normal message; four for the loop of a self-message,
 * with the corners rounded so the turn reads as one gesture.
 */
const pathOf = (points: Array<{ x: number; y: number }>): string => {
  const at = (index: number) =>
    `${round(points[index].x)},${round(points[index].y)}`;
  if (points.length === 2) return `M${at(0)} L${at(1)}`;

  const radius = 5;
  const [, out, back] = points;
  return [
    `M${at(0)}`,
    `L${round(out.x - radius)},${round(out.y)}`,
    `Q${round(out.x)},${round(out.y)} ${round(out.x)},${round(out.y + radius)}`,
    `L${round(back.x)},${round(back.y - radius)}`,
    `Q${round(back.x)},${round(back.y)} ${round(back.x - radius)},${round(back.y)}`,
    `L${at(3)}`,
  ].join(" ");
};
