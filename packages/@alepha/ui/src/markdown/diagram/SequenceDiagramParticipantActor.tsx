import * as React from "react";

void React;

import { DiagramLabel, round } from "./DiagramLabel.tsx";
import { DIAGRAM_LINE_HEIGHT } from "./textMetrics.ts";

export interface SequenceDiagramParticipantActorProps {
  centerX: number;
  top: number;
  lines: string[];
  height: number;
  fontSize: number;
}

/**
 * Head, body, arms and legs, with the name underneath.
 *
 * Drawn from primitives rather than one path so the shape stays readable,
 * the same call the flowchart node emitter made for its four shapes.
 *
 * ## The figure hangs from the label, not from the top of the box
 *
 * The layout sized this box as figure + gap + label. Redeclaring the
 * figure's own height here to draw downward from the top would be two
 * copies of one number in two files, which is precisely the text-and-box
 * disagreement the whole metrics path exists to avoid. Instead the label
 * height is recomputed from the lines the layout already measured - the
 * same `lines.length * fontSize * DIAGRAM_LINE_HEIGHT` `measureLabel` used
 * - and the figure is anchored just above it. If the box is ever given
 * more room, the figure simply gets more air over its head.
 */
export const SequenceDiagramParticipantActor = (
  props: SequenceDiagramParticipantActorProps,
) => {
  const cx = round(props.centerX);
  const labelHeight = props.lines.length * props.fontSize * DIAGRAM_LINE_HEIGHT;
  const feet = props.top + props.height - labelHeight - ACTOR_LABEL_GAP;
  const hips = feet - 8;
  const shoulders = hips - 10;
  const headRadius = 6;
  const headY = shoulders - headRadius - 1;
  const reach = 8;

  return (
    <g>
      <g stroke="var(--muted-foreground)" strokeWidth={1.3} fill="none">
        <circle cx={cx} cy={round(headY)} r={headRadius} />
        <path
          d={[
            `M${cx},${round(shoulders)} L${cx},${round(hips)}`,
            `M${round(cx - reach)},${round(shoulders + 4)} L${round(cx + reach)},${round(shoulders + 4)}`,
            `M${cx},${round(hips)} L${round(cx - reach)},${round(feet)}`,
            `M${cx},${round(hips)} L${round(cx + reach)},${round(feet)}`,
          ].join(" ")}
          strokeLinecap="round"
        />
      </g>
      <DiagramLabel
        lines={props.lines}
        centerX={props.centerX}
        centerY={props.top + props.height - labelHeight / 2}
        fontSize={props.fontSize}
        fill="var(--foreground)"
      />
    </g>
  );
};

/**
 * The one number this component and the layout do share: how far the name
 * sits below the feet.
 */
const ACTOR_LABEL_GAP = 4;
