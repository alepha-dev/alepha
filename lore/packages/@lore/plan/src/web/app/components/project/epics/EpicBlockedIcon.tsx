import { HoverCard, HoverCardContent, HoverCardTrigger } from "@alepha/ui";
import type { I18n } from "@lore/core/web";
import { useI18n } from "alepha/react/i18n";
import { Link } from "alepha/react/router";
import { Lock } from "lucide-react";

export interface EpicBlockedIconProps {
  /**
   * The predecessor epic's number, the one not completed yet.
   */
  blockedBy: number;
  /**
   * Where that epic's page is.
   */
  href: string;
}

/**
 * Says an epic is blocked by its predecessor (#Q4509): a colored lock in the
 * page header, where a muted "Blocked by Epic N" caption used to be, whose
 * hover card says why and links to the epic that blocks it.
 *
 * A button for a trigger, so a keyboard reaches the card as a pointer does,
 * and its name is the sentence the caption used to say.
 */
const EpicBlockedIcon = (props: EpicBlockedIconProps) => {
  const { tr } = useI18n<I18n, "en">();
  const label = tr("epic.start.blocked", { args: [String(props.blockedBy)] });
  return (
    <HoverCard>
      <HoverCardTrigger
        render={
          <button
            type="button"
            aria-label={label}
            data-testid="epic-blocked"
            className="focus-visible:ring-ring/50 inline-flex size-8 items-center justify-center rounded-md text-amber-600 outline-none focus-visible:ring-3 dark:text-amber-400"
          />
        }
      >
        <Lock className="size-4" aria-hidden />
      </HoverCardTrigger>
      <HoverCardContent
        className="flex w-72 flex-col gap-1.5 p-3 text-xs"
        data-testid="epic-blocked-card"
      >
        <span className="text-sm font-semibold">{label}</span>
        <span className="text-muted-foreground">
          {tr("epic.start.blockedWhy")}
        </span>
        <Link
          href={props.href}
          className="text-primary font-medium hover:underline"
          data-testid="epic-blocked-link"
        >
          {tr("epic.start.blockedOpen", { args: [String(props.blockedBy)] })}
        </Link>
      </HoverCardContent>
    </HoverCard>
  );
};

export default EpicBlockedIcon;
