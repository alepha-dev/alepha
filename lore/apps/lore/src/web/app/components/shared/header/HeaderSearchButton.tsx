import { Button } from "@alepha/ui/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui/components/ui/tooltip";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Search } from "lucide-react";
import { type ReactElement, useEffect } from "react";
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
 * Both openers are gated on there being an open project, because the palette
 * they open is project-scoped end to end — off a project it can only offer a
 * disabled input. ⌘K goes with the button deliberately, not incidentally: a
 * shortcut that opens a palette which can search nothing is worse than no
 * shortcut. If ⌘K ever grows a global job (jumping between projects, say), it
 * has to move out of this component first.
 */
const HeaderSearchButton = (): ReactElement | null => {
  const { tr } = useI18n<I18n, "en">();
  const [, setSpotlight] = useStore(spotlightOpenAtom);
  const [project] = useStore(currentProjectAtom);
  const label = String(tr("header.actions.search"));
  const open = (): void => setSpotlight({ open: true });
  const projectId = project?.id;

  useEffect(() => {
    if (projectId === undefined) return;
    const onKeyDown = (event: KeyboardEvent): void => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== "k"
      ) {
        return;
      }
      event.preventDefault();
      open();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [setSpotlight, projectId]);

  if (projectId === undefined) {
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
