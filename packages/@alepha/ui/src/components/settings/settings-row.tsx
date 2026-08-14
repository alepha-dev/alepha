import { CardContent } from "@alepha/ui/components/ui/card";
import { cn } from "@alepha/ui/lib/utils";
import type { ReactNode } from "react";

export interface SettingsRowProps {
  /**
   * What the row is about. Rendered as the emphasised left-hand text.
   */
  label: ReactNode;

  /**
   * One line of explanation under the label. Omit when the label says it all
   * — an empty helper line is worse than none.
   */
  description?: ReactNode;

  /**
   * `id` of the form control this row labels. Set it whenever `children` is an
   * input: the label then renders as a real `<label htmlFor>` rather than a
   * `<span>`, which is what gives the control an accessible name and makes
   * clicking the label focus it.
   *
   * Without it the row is a `<span>` — correct for a row whose control is a
   * button or a read-only value, where the button carries its own name and a
   * `<label>` pointing at nothing would be worse than none.
   */
  htmlFor?: string;

  /**
   * The control this row exists for: a button, a switch, a badge, a value.
   * Sits right of the label on `sm` and up, and underneath it below that.
   */
  children?: ReactNode;

  className?: string;
}

/**
 * One line of a settings card: label and optional help on the left, a single
 * control on the right.
 *
 * The grid is `minmax(0,1fr) auto`, not `justify-between`. The difference
 * matters when the label is long: `minmax(0,…)` lets the text column shrink
 * and wrap, where a flex row would let it push the control off the card. It
 * collapses to a stacked `flex-col` below `sm`, because a button crushed into
 * a 90px column is worse than a button on its own line.
 *
 * Rows carry all the vertical padding (`py-3`) and {@link SettingsSection}'s
 * card carries none (`py-0`) — see that component for why the two must not
 * both have it.
 */
export const SettingsRow = (props: SettingsRowProps) => {
  return (
    <CardContent
      className={cn(
        "flex flex-col gap-3 px-4 py-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-6",
        props.className,
      )}
    >
      <div className="flex flex-col gap-0.5">
        {props.htmlFor ? (
          <label htmlFor={props.htmlFor} className="font-medium text-sm">
            {props.label}
          </label>
        ) : (
          <span className="font-medium text-sm">{props.label}</span>
        )}
        {props.description ? (
          <span className="text-muted-foreground text-xs">
            {props.description}
          </span>
        ) : null}
      </div>
      {props.children ? (
        <div className="flex justify-start sm:justify-end">
          {props.children}
        </div>
      ) : null}
    </CardContent>
  );
};
