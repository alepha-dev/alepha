import { cn } from "@alepha/ui/lib/utils";
import { useI18n } from "alepha/react/i18n";

import type { I18n } from "../../../services/I18n.ts";
import type { AppLiveness } from "./appLiveness.ts";

export interface AppStatusDotProps {
  state: AppLiveness;
}

/**
 * Liveness before the app name, in the width of a dot.
 *
 * It carries what the `Reports` and `Last seen` columns used to say, which is
 * why it has to say it in more than one way:
 *
 * - **`title` and `aria-label`**, because a colour is not a label and a screen
 *   reader gets nothing from a `<span>` of background.
 * - **Shape as well as hue.** Filled versus hollow already separates "never
 *   wired up" from the other two; reporting and silent are separated by a ring
 *   as well as by colour, because green against amber is the pair deuteranopia
 *   hits hardest and the columns that used to disambiguate are gone.
 */
const AppStatusDot = (props: AppStatusDotProps) => {
  const { tr } = useI18n<I18n, "en">();

  const label = String(
    props.state === "reporting"
      ? tr("apps.status.reporting")
      : props.state === "silent"
        ? tr("apps.status.silent")
        : tr("apps.status.none"),
  );

  return (
    <span
      // `title` for a pointer, `aria-label` + `role` for a reader. The element
      // is presentational otherwise, so without the role the label is dropped.
      role="img"
      title={label}
      aria-label={label}
      data-state={props.state}
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        props.state === "reporting" && "bg-emerald-500",
        // A ring rather than colour alone: the amber and the green have to be
        // told apart by something that is not hue.
        props.state === "silent" &&
          "bg-amber-500 ring-2 ring-amber-500/30 ring-offset-0",
        // Hollow: nothing is wrong, nothing is reporting.
        props.state === "none" &&
          "border-muted-foreground/50 border bg-transparent",
      )}
    />
  );
};

export default AppStatusDot;
