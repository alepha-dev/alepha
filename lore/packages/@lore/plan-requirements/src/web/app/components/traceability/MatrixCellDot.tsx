import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";

import type { MatrixCell } from "./matrixCells.ts";

export interface MatrixCellDotProps {
  state: MatrixCell;
}

/**
 * One cell of the traceability matrix (#E153), in the kit's own success,
 * danger and warning colours: the hues every status chip is drawn in.
 */
const MatrixCellDot = (props: MatrixCellDotProps) => {
  const { tr } = useI18n<I18n, "en">();
  return (
    <span
      className={`inline-block size-5 rounded ${MATRIX_CELL_CLASS[props.state]}`}
      title={tr(MATRIX_CELL_LABEL_KEYS[props.state])}
      data-cell={props.state}
    />
  );
};

export default MatrixCellDot;

const MATRIX_CELL_CLASS: Record<MatrixCell, string> = {
  verified: "bg-success",
  failing: "bg-danger",
  in_development: "bg-primary/60",
  stale: "bg-success ring-2 ring-warning ring-offset-1",
  never_run: "border-2 border-muted-foreground/40",
  none: "bg-muted/60",
};

export const MATRIX_CELL_LABEL_KEYS = {
  verified: "requirements.trace.cell.verified",
  failing: "requirements.trace.cell.failing",
  in_development: "requirements.trace.cell.in_development",
  stale: "requirements.trace.cell.stale",
  never_run: "requirements.trace.cell.never_run",
  none: "requirements.trace.cell.none",
} as const;
