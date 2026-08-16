import { cn } from "@alepha/ui/lib/utils";
import type { ReactNode } from "react";

export interface SettingsHeadingProps {
  /**
   * What this block of the page is. A noun phrase naming the thing, not a verb
   * phrase describing the action: "Active sessions", not "Manage sessions".
   */
  title?: ReactNode;

  /**
   * One line under the title. The place to put what the reader needs to know
   * before touching anything below it — a consequence, a constraint, a limit.
   * Skip it rather than restate the title in more words.
   */
  description?: ReactNode;

  className?: string;
}

/**
 * The title + description pair that sits above a settings block.
 *
 * It exists so there is exactly one of it. {@link SettingsSection} renders this
 * for the common case (a heading over a card of {@link SettingsRow}s), and a
 * page whose content is not a card of rows — a table, a list of invitations —
 * uses it directly instead of hand-rolling the markup.
 *
 * That hand-rolling is the failure this prevents, and it had already happened:
 * `apps/lore`'s account pages grew an `<h2 className="text-base font-semibold">`
 * on one page and a bare `<span className="text-xs">` with no title at all on
 * another, so the `/account` rail led to three different type scales depending
 * on which entry you clicked. Nothing was broken and nothing could have failed
 * — it just read as three pages from three different applications.
 *
 * ⚠️ **No em dash in these strings.** House rule across every user-facing
 * string, in this component and everywhere else: use a comma, a semicolon, a
 * full stop, or split the sentence in two.
 */
export const SettingsHeading = (props: SettingsHeadingProps) => {
  if (props.title == null && props.description == null) return null;

  return (
    <div className={cn("flex flex-col gap-0.5", props.className)}>
      {props.title != null ? (
        <span className="text-sm">{props.title}</span>
      ) : null}
      {props.description != null ? (
        <span className="text-muted-foreground text-xs">
          {props.description}
        </span>
      ) : null}
    </div>
  );
};
