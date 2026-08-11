import { Button } from "@alepha/ui/components/ui/button";
import { Kbd } from "@alepha/ui/components/ui/kbd";
import { useStore } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { Search } from "lucide-react";
import type { ReactElement } from "react";
import { currentProjectAtom } from "../../../atoms/currentProjectAtom.ts";
import { spotlightOpenAtom } from "../../../atoms/spotlightOpenAtom.ts";
import type { I18n } from "../../../services/I18n.ts";

/**
 * The search entry point — an input-shaped trigger to the LEFT of Create
 * Quest, rather than a magnifier inside the header's icon cluster.
 *
 * It is still a button, not an input. Typing happens in the palette's own
 * `CommandInput`, and a real `<input>` here would either need its query
 * handing over on open (two inputs, one of which is a lie) or would swallow
 * the first keystrokes before the dialog mounted. A button styled as a field
 * is what every palette trigger of this shape does, and the ⌘K hint is what
 * tells you it is a shortcut and not a text box.
 *
 * Opening is centralised here — the trigger and ⌘K both flip the same atom,
 * so the palette that reads it has one way in rather than one per caller.
 *
 * The TRIGGER is gated on there being an open project: off one, the palette
 * has no quests or folios to search and this would promise something it cannot
 * do. ⌘K is not gated and does not live here — the palette does something
 * useful off-project (it switches projects), so the shortcut outlived the
 * button and moved to `Spotlight`, which is mounted app-wide. A shortcut owned
 * by a component that unmounts is a shortcut that disappears.
 *
 * The guard is kept even though this now renders from `ProjectView`'s topbar,
 * which is already inside the project layout: the atom is filled by the route
 * loader, so there is a frame where the layout is mounted and the project is
 * not yet known.
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
    <Button
      variant="outline"
      // Collapses to a plain square icon button below `sm`, where a 224px
      // field would crowd out Create Quest entirely.
      className="text-muted-foreground size-9 justify-center px-0 font-normal sm:h-9 sm:w-56 sm:justify-start sm:px-3"
      aria-label={label}
      onClick={open}
    >
      <Search className="size-4 shrink-0" />
      <span className="hidden flex-1 text-left sm:inline">{label}</span>
      <Kbd className="hidden sm:inline-flex">⌘K</Kbd>
    </Button>
  );
};

export default HeaderSearchButton;
