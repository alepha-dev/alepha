import { SettingsHeading } from "@alepha/ui/components/settings/settings-heading";
import { Card } from "@alepha/ui/components/ui/card";
import { cn } from "@alepha/ui/lib/utils";
import type { ReactNode } from "react";

export interface SettingsSectionProps {
  /**
   * Heading above the card. Optional — a page whose first section needs no
   * heading (because the page title already says it) omits it.
   */
  title?: ReactNode;

  /**
   * One line under the title, for context the rows themselves should not
   * each repeat.
   */
  description?: ReactNode;

  /**
   * {@link SettingsRow}s. Anything else works too, but the divider and the
   * padding contract below assume rows.
   */
  children: ReactNode;

  className?: string;
}

/**
 * A titled group of settings rows in one bordered card — the GitHub-settings
 * shape.
 *
 * ⚠️ **The card is `py-0` and that is deliberate.** `Card` ships its own
 * vertical padding (`py-(--card-spacing)`), and every {@link SettingsRow}
 * brings `py-3`. Leave both on and the two stack into a visibly thick blank
 * band at the top and bottom of the card. `py-0` opts the card out so each
 * row's own padding is the only vertical space, which is also what makes
 * `divide-y` land flush between rows.
 *
 * The rule is one or the other, never both — so do **not** "fix" this to a
 * numeric `py-4` / `py-3`. Several pages in `apps/lore`'s project settings did
 * exactly that and they are the ones that look wrong next to these.
 */
export const SettingsSection = (props: SettingsSectionProps) => {
  return (
    <div className={cn("flex flex-col gap-2", props.className)}>
      <SettingsHeading title={props.title} description={props.description} />
      <Card className="bg-card gap-0 divide-y rounded-lg border py-0">
        {props.children}
      </Card>
    </div>
  );
};
