import { Button } from "@alepha/ui/components/ui/button";
import { Kbd } from "@alepha/ui/components/ui/kbd";
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
 * The search entry point — a magnifier in the header's icon cluster.
 *
 * It was an input-shaped trigger 224px wide, sitting left of Create Quest with
 * a visible label and a ⌘K hint. That shape advertises the shortcut and reads
 * as a search field, which is why palette triggers usually take it; it also
 * spent a quarter of the topbar on a control whose entire job is to open a
 * dialog. Reduced to an icon, it joins the other ambient controls and gives
 * that width back to the breadcrumbs.
 *
 * ⚠️ **The ⌘K affordance is now unadvertised.** The shortcut still works — it
 * lives in `Spotlight`, app-wide — but nothing on screen says so, and the
 * tooltip is the only place left that mentions it. That is the real cost of
 * this shape, and it is deliberate rather than overlooked.
 *
 * Which is why the hint is in a real `Tooltip` rather than a `title`
 * attribute. `title` renders the browser's own tooltip: it takes about a
 * second to appear, is styled by the OS rather than the app, and sits
 * unstyled beside three neighbours that all use the shared popup. Every other
 * button in this cluster (language, theme, dark mode, account) wraps itself
 * in `Tooltip`/`TooltipTrigger`, so the one that did not was the one that
 * looked broken. `TooltipTrigger`'s `render` prop keeps the `Button` as the
 * rendered element instead of nesting a second one inside it.
 *
 * Still a button, never an input: typing happens in the palette's own
 * `CommandInput`, and a real `<input>` here would either hand its query over on
 * open (two inputs, one of which is a lie) or swallow the first keystrokes
 * before the dialog mounted.
 *
 * Opening is centralised here — the trigger and ⌘K both flip the same atom, so
 * the palette that reads it has one way in rather than one per caller.
 *
 * The TRIGGER is gated on there being an open project: off one, the palette has
 * no quests or folios to search and this would promise something it cannot do.
 * ⌘K is not gated and does not live here — the palette does something useful
 * off-project (it switches projects), so the shortcut outlived the button and
 * moved to `Spotlight`. A shortcut owned by a component that unmounts is a
 * shortcut that disappears.
 *
 * That guard is what makes it safe to hand this to `HeaderActions`, which also
 * renders off-project: there, this returns `null` and the cluster is unchanged.
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
          // `ghost` + `icon`, matching `AppActions`'s own four buttons
          // exactly: it sits among them, so any other variant would read as
          // a different kind of control wedged into the cluster.
          <Button
            variant="ghost"
            size="icon"
            aria-label={label}
            onClick={open}
          />
        }
      >
        <Search className="size-4 shrink-0" />
      </TooltipTrigger>
      {/* The only remaining mention of the shortcut anywhere on screen. */}
      <TooltipContent>
        {label}
        <Kbd>⌘K</Kbd>
      </TooltipContent>
    </Tooltip>
  );
};

export default HeaderSearchButton;
