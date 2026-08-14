import { Card } from "@alepha/ui/components/ui/card";
import { cn } from "@alepha/ui/lib/utils";
import type { ReactNode } from "react";

export interface SettingsDangerSectionProps {
  /**
   * Heading above the card.
   *
   * @default "Danger zone"
   */
  title?: ReactNode;

  /**
   * One line under the title.
   */
  description?: ReactNode;

  /**
   * {@link SettingsRow}s, each holding a `variant="destructive"` control.
   */
  children: ReactNode;

  className?: string;
}

/**
 * {@link SettingsSection} for irreversible actions — delete, leave, revoke
 * everything.
 *
 * Identical in structure, with a destructive-tinted border and title. The
 * colour is doing real work rather than decorating: these rows sit in the
 * same visual rhythm as every harmless row above them, and without a boundary
 * the only thing separating "change your display name" from "delete your
 * account" is the button colour at the moment of the click.
 *
 * The tint stays at 30–40% opacity on purpose. A full-strength destructive
 * border reads as *"something is wrong"* rather than *"be careful here"*, and
 * a settings page that looks like it is erroring every time you open it
 * teaches people to ignore the colour.
 */
export const SettingsDangerSection = (props: SettingsDangerSectionProps) => {
  const { title = "Danger zone" } = props;

  return (
    <div className={cn("flex flex-col gap-2", props.className)}>
      <div className="flex flex-col gap-0.5">
        <span className="text-destructive text-sm">{title}</span>
        {props.description != null ? (
          <span className="text-muted-foreground text-xs">
            {props.description}
          </span>
        ) : null}
      </div>
      <Card className="gap-0 divide-y divide-destructive/20 rounded-lg border border-destructive/30 bg-card py-0">
        {props.children}
      </Card>
    </div>
  );
};
