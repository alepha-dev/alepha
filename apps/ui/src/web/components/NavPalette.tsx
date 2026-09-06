import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@alepha/ui/components/ui/command";
import { useStore } from "alepha/react";
import { useRouter } from "alepha/react/router";
import { useEffect, useMemo } from "react";

import { NAV_DESTINATIONS } from "../nav.ts";
import { navPaletteAtom } from "../navPaletteAtom.ts";

/**
 * The command palette, and the ⌘K that opens it.
 *
 * Mounted ONCE, by `Layout.tsx`, so both the shortcut and the dialog exist on
 * every page. Its triggers live elsewhere and reach it through
 * {@link navPaletteAtom}: `NavPaletteButton` in the top bar, `NavPaletteField`
 * in the home hero.
 *
 * Its rows come from `NAV_DESTINATIONS`, the same tree the sidebar renders,
 * rather than from `@alepha/ui`'s `Spotlight`: that one reads `nav` metadata
 * off each `$page`, and this app declares none - it hand-writes `NAV` instead,
 * because its sidebar nests one level deeper than a flat `nav.group` can
 * express.
 */
export const NavPalette = () => {
  const router = useRouter();
  const [open, setOpen] = useStore(navPaletteAtom);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(!open);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, setOpen]);

  // Bucketed in NAV order, so the palette lists the site the way the sidebar
  // does instead of alphabetically.
  const groups = useMemo(() => {
    const out: { label: string; items: typeof NAV_DESTINATIONS }[] = [];
    for (const destination of NAV_DESTINATIONS) {
      const last = out[out.length - 1];
      if (last?.label === destination.group) {
        last.items.push(destination);
      } else {
        out.push({ label: destination.group, items: [destination] });
      }
    }
    return out;
  }, []);

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Search"
      description="Jump to any block or page in the showcase."
    >
      <Command>
        {/*
          `jsx-a11y/no-autofocus` is about a PAGE that grabs focus unbidden.
          This is a modal the reader just opened to type into, and the dialog
          does not put the caret there on its own: opened with ⌘K,
          `document.activeElement` stays on `<body>`, so cmdk's own key
          handling (arrows, Enter) never sees a keystroke and the palette is
          mouse-only. The same disable is on every `autoFocus` in `@alepha/ui`,
          for the same reason.
        */}
        {/* oxlint-disable-next-line jsx-a11y/no-autofocus */}
        <CommandInput autoFocus placeholder="Search blocks and pages…" />
        <CommandList>
          <CommandEmpty>Nothing matches that.</CommandEmpty>
          {groups.map((group) => (
            <CommandGroup key={group.label} heading={group.label || undefined}>
              {group.items.map((destination) => (
                <CommandItem
                  key={destination.href}
                  // What cmdk filters on. The parent and the group are in it
                  // so that "layout" finds App shell and "admin" finds Jobs,
                  // neither of which carries the word in its own label.
                  value={`${group.label} ${destination.parent ?? ""} ${destination.label}`}
                  onSelect={() => {
                    setOpen(false);
                    void router.push(destination.href);
                  }}
                >
                  {destination.icon ? <destination.icon /> : null}
                  <span>{destination.label}</span>
                  {destination.parent ? (
                    <span className="text-muted-foreground ml-auto text-xs">
                      {destination.parent}
                    </span>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>
    </CommandDialog>
  );
};
