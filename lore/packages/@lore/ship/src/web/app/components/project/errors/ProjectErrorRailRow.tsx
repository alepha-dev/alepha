import type { ReactNode } from "react";

export interface ProjectErrorRailRowProps {
  label: string;
  /**
   * The value. A row whose value is `undefined` or `null` renders nothing:
   * the rail never shows a label waiting for data that is not coming.
   */
  children?: ReactNode;
  testId?: string;
}

/**
 * One definition row of the error page's rail: a muted label on the left,
 * the value right-aligned. The shape of the quest rail's row.
 */
const ProjectErrorRailRow = (props: ProjectErrorRailRowProps) => {
  if (props.children === undefined || props.children === null) return null;
  return (
    <div
      className="flex items-center justify-between gap-3 py-1.5"
      data-testid={props.testId}
    >
      <span className="text-muted-foreground shrink-0 text-xs">
        {props.label}
      </span>
      {/* `break-words`: a fingerprint or a page address has no space to
          wrap on, and the cell is right-aligned, so it would spill over the
          label. */}
      <span className="min-w-0 text-right text-xs font-medium break-words">
        {props.children}
      </span>
    </div>
  );
};

export default ProjectErrorRailRow;
