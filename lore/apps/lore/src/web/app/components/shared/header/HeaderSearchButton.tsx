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
import { spotlightOpenAtom } from "../../../atoms/spotlightOpenAtom.ts";
import type { I18n } from "../../../services/I18n.ts";

/**
 * The search entry point, first in the header's icon cluster.
 *
 * Opening is centralised here — the button and ⌘K both flip the same atom,
 * so the palette that reads it has one way in rather than one per caller.
 * Bound in the capture phase for the same reason the folio workspace binds
 * its own shortcuts there: ⌘K reaches a focused input otherwise.
 */
const HeaderSearchButton = (): ReactElement => {
  const { tr } = useI18n<I18n, "en">();
  const [, setSpotlight] = useStore(spotlightOpenAtom);
  const label = String(tr("header.actions.search"));
  const open = (): void => setSpotlight({ open: true });

  useEffect(() => {
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
  }, [setSpotlight]);

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
