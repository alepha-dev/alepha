import type { ReactNode } from "react";

export interface ProjectSettingsBodyProps {
  /**
   * The open tab's `fullWidth` (`SettingsTab`): run the body's full width
   * and height rather than the centred, readable column.
   */
  fullWidth?: boolean;
  children?: ReactNode;
}

/**
 * The settings body under the tabs (#Q3658).
 *
 * A page of setting blocks reads in a centred `max-w-6xl` column; a tab that
 * declares `fullWidth` (Hosts' flat table, the Ranks matrix) gets the whole
 * body, at exactly its height (`h-full`): a table taking `flex-1 min-h-0`
 * reaches the bottom edge and scrolls inside, under a header that stays put
 * (#Q3666).
 * The choice is the tab's, so widening one page never widens the others, the
 * regression 51e794e71 made by dropping the column for every tab at once.
 */
const ProjectSettingsBody = (props: ProjectSettingsBodyProps) => (
  <div
    data-testid="settings-body"
    data-full-width={props.fullWidth ? "true" : undefined}
    className={
      props.fullWidth
        ? "flex h-full w-full flex-col gap-8 p-4 md:p-6"
        : "mx-auto flex w-full max-w-6xl flex-col gap-8 p-4 md:p-6"
    }
  >
    {props.children}
  </div>
);

export default ProjectSettingsBody;
