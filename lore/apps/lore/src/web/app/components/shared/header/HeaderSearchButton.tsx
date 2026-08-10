import { Button } from "@alepha/ui/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui/components/ui/tooltip";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Search } from "lucide-react";
import type { ReactElement } from "react";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { spotlightOpenAtom } from "../../../atoms/spotlightOpenAtom.ts";
import type { I18n } from "../../../services/I18n.ts";

/**
 * The search entry point, first in the header's icon cluster.
 *
 * Opening is centralised here — the button and ⌘K both flip the same atom,
 * so the palette that reads it has one way in rather than one per caller.
 * Bound in the capture phase for the same reason the folio workspace binds
 * its own shortcuts there: ⌘K reaches a focused input otherwise.
 *
 * The BUTTON is gated on there being an open project: off one, the palette has
 * no quests or folios to search and the magnifier would promise something it
 * cannot do. ⌘K is not gated and no longer lives here — the palette does
 * something useful off-project now (it switches projects), so the shortcut
 * outlived the button and moved to `Spotlight`, which is mounted app-wide.
 * A shortcut owned by a component that unmounts is a shortcut that disappears.
 */
const HeaderSearchButton = (): ReactElement | null => {
  const { tr } = useI18n<I18n, "en">();
  const [, setSpotlight] = useStore(spotlightOpenAtom);
  const [project] = useStore(currentProjectAtom);
  const label = String(tr("header.actions.search"));
  const open = (): void => setSpotlight({ open: true });

  if (project?.id === undefined) {
    return null;
  }

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            aria-label={label}
            onClick={open}
          />
        }
      >
        <Search className="size-4" />
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
};

export default HeaderSearchButton;
