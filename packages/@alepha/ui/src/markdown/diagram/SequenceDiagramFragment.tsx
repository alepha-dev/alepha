import * as React from "react";

void React;

import { round } from "./DiagramLabel.tsx";
import type { PositionedFragment } from "./layoutSequence.ts";

export interface SequenceDiagramFragmentProps {
  fragment: PositionedFragment;
  fontSize: number;
}

/**
 * The box around an `alt`, `opt` or `loop`, its corner tab, and a dashed
 * divider at each `else`.
 *
 * ## Why fragments are drawn at all, when activation bars were cut
 *
 * Without them an `alt` block has two outcomes and both are bad: refuse the
 * whole diagram, or draw the branches one under the other as though they
 * all happen. The second is silently wrong output about a protocol, which
 * is the one failure mode the design refuses to ship.
 *
 * The box is an outline with no fill, so it never hides a lifeline it
 * spans and its z-order does not matter. Only the tab is filled, because
 * it sits on top of the lifelines it crosses.
 */
export const SequenceDiagramFragment = (
  props: SequenceDiagramFragmentProps,
) => {
  const fragment = props.fragment;
  const x = round(fragment.x);
  const y = round(fragment.y);
  const width = round(fragment.width);
  const small = props.fontSize * 0.92;
  const notch = 6;

  return (
    <g data-fragment={fragment.kind}>
      <rect
        x={x}
        y={y}
        width={width}
        height={round(fragment.height)}
        rx={4}
        ry={4}
        fill="none"
        stroke="var(--border)"
        strokeWidth={1.25}
      />
      {fragment.dividers.map((divider) => (
        <g key={`${round(divider.y)}:${divider.label}`}>
          <line
            x1={x}
            y1={round(divider.y)}
            x2={round(fragment.x + fragment.width)}
            y2={round(divider.y)}
            stroke="var(--border)"
            strokeWidth={1.25}
            strokeDasharray="5 4"
          />
          {divider.label ? (
            // BELOW the line, not above it. An `else` names the branch it
            // OPENS, so a label sitting over the divider reads as the last
            // word of the branch that just ended - which is the opposite of
            // what the author wrote.
            <text
              x={round(fragment.x + 8)}
              y={round(divider.y + small + 2)}
              textAnchor="start"
              fontSize={small}
              fill="var(--muted-foreground)"
            >
              [{divider.label}]
            </text>
          ) : null}
        </g>
      ))}
      {/*
        A rectangle with its bottom-right corner cut, which is how UML draws
        the fragment operator. One path rather than a rect plus a polygon,
        so the outline is continuous.
      */}
      <path
        d={[
          `M${x},${y}`,
          `L${round(fragment.x + fragment.tabWidth)},${y}`,
          `L${round(fragment.x + fragment.tabWidth)},${round(fragment.y + fragment.tabHeight - notch)}`,
          `L${round(fragment.x + fragment.tabWidth - notch)},${round(fragment.y + fragment.tabHeight)}`,
          `L${x},${round(fragment.y + fragment.tabHeight)}`,
          "z",
        ].join(" ")}
        fill="var(--muted)"
        stroke="var(--border)"
        strokeWidth={1.25}
      />
      <text
        x={round(fragment.x + fragment.tabWidth / 2)}
        y={round(fragment.y + fragment.tabHeight / 2 + props.fontSize * 0.36)}
        textAnchor="middle"
        fontSize={small}
        fontWeight={600}
        fill="var(--muted-foreground)"
      >
        {fragment.kind}
      </text>
      {fragment.label ? (
        <text
          x={round(fragment.x + fragment.tabWidth + 8)}
          y={round(fragment.y + fragment.tabHeight / 2 + props.fontSize * 0.36)}
          textAnchor="start"
          fontSize={small}
          fill="var(--muted-foreground)"
        >
          [{fragment.label}]
        </text>
      ) : null}
    </g>
  );
};
