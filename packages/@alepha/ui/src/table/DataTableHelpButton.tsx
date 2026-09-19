import { useI18n } from "alepha/react/i18n";
import { CircleHelp } from "lucide-react";
import { type ReactNode, useState } from "react";

import { Button } from "../core/Button.tsx";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "../core/HoverCard.tsx";

export interface DataTableHelpButtonProps {
  /**
   * What the hover card holds: the table's `help`.
   */
  children: ReactNode;
}

/**
 * The `?` at the end of the toolbar's icon group, opening a hover card with
 * the page's explanation.
 *
 * A hover card opens on hover and on keyboard focus, and stays open while the
 * pointer crosses into it, so a link inside can be reached. Neither of those
 * happens on a touch screen: the hover is mouse-only, and a tap does not count
 * as a visible focus. So the state is held here and a click opens it too, and
 * the card closes as any hover card does, on Escape or a press outside.
 */
export const DataTableHelpButton = (props: DataTableHelpButtonProps) => {
  const { tr } = useI18n();
  const [open, setOpen] = useState(false);
  const label = tr("dataTable.help", { default: "Help" });

  return (
    <HoverCard open={open} onOpenChange={(next) => setOpen(next)}>
      <HoverCardTrigger
        // Shorter than the hover card's own 600ms: the reader pointing at a
        // `?` is asking for it, not skimming past a link.
        delay={200}
        render={
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-9 w-9 p-0"
            aria-label={label}
            onClick={() => setOpen(true)}
          />
        }
      >
        <CircleHelp className="size-4" />
      </HoverCardTrigger>
      <HoverCardContent
        side="bottom"
        align="end"
        className="w-80 max-w-[calc(100vw-2rem)] p-3 leading-relaxed"
      >
        {props.children}
      </HoverCardContent>
    </HoverCard>
  );
};
