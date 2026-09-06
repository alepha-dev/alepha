import { Button } from "@alepha/ui/components/ui/button";
import { Kbd, KbdGroup } from "@alepha/ui/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@alepha/ui/components/ui/tooltip";
import { useStore } from "alepha/react";
import { SearchIcon } from "lucide-react";

import { navPaletteAtom } from "../navPaletteAtom.ts";
import { useShortcutModifier } from "../useShortcutModifier.ts";

/**
 * The magnifier in the top bar. Opens {@link NavPalette}, which is mounted by
 * `Layout.tsx` beside it.
 *
 * Shaped like `ButtonTheme` and `ButtonDark` deliberately - ghost, icon-sized,
 * tooltip carrying the name - because it sits in the same row and a control
 * that announced itself differently would read as belonging to the page rather
 * than to the shell.
 *
 * The shortcut is in the tooltip rather than on the button: an icon button has
 * nowhere to put a keycap, and `Kbd` already styles itself for a tooltip
 * ground. This is the only place the shortcut is advertised away from the home
 * page, which is what a reader deep in `/pages/admin/*` needs to see it.
 */
export const NavPaletteButton = () => {
  const [, setOpen] = useStore(navPaletteAtom);
  const modifier = useShortcutModifier();

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            // "Search", not "Search blocks and pages": an action keeps one
            // name through the whole flow, and the tooltip beside it says
            // Search. It also keeps this button distinct from the hero's
            // field, whose name IS its visible text.
            aria-label="Search"
            onClick={() => setOpen(true)}
          />
        }
      >
        <SearchIcon className="size-4" />
      </TooltipTrigger>
      <TooltipContent className="flex items-center gap-2">
        Search
        <KbdGroup>
          <Kbd>{modifier}</Kbd>
          <Kbd>K</Kbd>
        </KbdGroup>
      </TooltipContent>
    </Tooltip>
  );
};
