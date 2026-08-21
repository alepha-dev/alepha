import * as React from "react";

void React;

import { round } from "./FlowchartDiagram.tsx";
import { DIAGRAM_LINE_HEIGHT } from "./textMetrics.ts";

export interface FlowchartDiagramLabelProps {
  /** Already wrapped and capped by `measureLabel` - draw exactly these. */
  lines: string[];
  centerX: number;
  centerY: number;
  fontSize: number;
  fill: string;
}

/**
 * A centred, multi-line label, one `tspan` per line.
 *
 * The line box has to match `DIAGRAM_LINE_HEIGHT`, which is what
 * `measureLabel` sized the box with: text and box disagreeing is the
 * failure mode this whole metrics path exists to avoid.
 *
 * `dominant-baseline` is not used: jsdom and older Safari disagree about it,
 * and shifting the first line by hand is arithmetic that works everywhere.
 */
export const FlowchartDiagramLabel = (props: FlowchartDiagramLabelProps) => {
  const lineBox = props.fontSize * DIAGRAM_LINE_HEIGHT;
  // The stack is centred on `centerY`, then each line sits on its own
  // baseline. `0.36em` is the optical centre of a lowercase run.
  const firstBaseline =
    props.centerY -
    ((props.lines.length - 1) * lineBox) / 2 +
    props.fontSize * 0.36;

  return (
    <text
      x={round(props.centerX)}
      y={round(firstBaseline)}
      textAnchor="middle"
      fill={props.fill}
    >
      {props.lines.map((line, index) => (
        <tspan
          // Lines are positional and may legitimately repeat, so the index
          // is the identity here.
          key={`${index}:${line}`}
          x={round(props.centerX)}
          dy={index === 0 ? 0 : round(lineBox)}
        >
          {line}
        </tspan>
      ))}
    </text>
  );
};
