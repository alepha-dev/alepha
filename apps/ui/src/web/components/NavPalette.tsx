import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@alepha/ui/components/ui/command";
import { Kbd } from "@alepha/ui/components/ui/kbd";
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
      // `DialogContent` is `sm:max-w-sm`, 384px, which is a dialog width
      // rather than a palette one: it left the path column pressed against
      // the label with nowhere for either to breathe.
      className="sm:max-w-[600px]"
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
        {/*
          `max-h-72` is sized for one-line rows; at two lines it showed four
          and a sliver, which reads as a list that ran out rather than one you
          scroll.
        */}
        <CommandList className="max-h-[22rem]">
          <CommandEmpty>Nothing matches that.</CommandEmpty>
          {groups.map((group) => (
            <CommandGroup key={group.label} heading={group.label || undefined}>
              {group.items.map((destination) => (
                <CommandItem
                  key={destination.href}
                  className="items-start gap-2.5 py-2"
                  // What cmdk filters on. The parent and the group are in it
                  // so that "layout" finds App shell and "admin" finds Jobs,
                  // neither of which carries the word in its own label.
                  //
                  // ⚠️ The DESCRIPTION is deliberately absent, though it is
                  // right there on the row. cmdk scores a fuzzy SUBSEQUENCE
                  // over the whole value and favours short ones, so folding a
                  // sentence in wrecked the ranking: "audit" put Home first
                  // (14 hits) and "audit trail" put Sidebar first, with Audit
                  // log nowhere. Measured, both as `value` and through
                  // `keywords`, which cmdk feeds to the same scorer. Searching
                  // descriptions needs a custom `filter` that matches
                  // substrings, not a longer string handed to this one.
                  value={`${group.label} ${destination.parent ?? ""} ${destination.label}`}
                  onSelect={() => {
                    setOpen(false);
                    void router.push(destination.href);
                  }}
                >
                  {destination.icon ? (
                    <destination.icon className="mt-0.5 size-4 shrink-0" />
                  ) : null}
                  {/*
                    Two lines, so the row says what the page IS and not only
                    what it is called. `min-w-0` on the column is what lets
                    both lines truncate: without it a flex child refuses to
                    shrink below its content and the path column gets pushed
                    off the row by a long description.
                  */}
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate">{destination.label}</span>
                    {destination.description ? (
                      <span className="text-muted-foreground truncate text-xs">
                        {destination.description}
                      </span>
                    ) : null}
                  </div>
                  {/*
                    The PATH, not the parent. Every leaf under Layout carried
                    the word "Layout" on the right, so the column read as five
                    copies of one word instead of as information. A path is
                    unique per row, says where the page lives including its
                    parent, and is what a reader would copy.

                    ⚠️ `CommandShortcut`, not a span with `ml-auto`.
                    `CommandItem` appends a trailing `CheckIcon` carrying
                    `ml-auto` of its own, so a plain span lands mid-row with
                    the check holding the right edge - which is the ragged
                    column this replaced. The check hides itself in the
                    presence of a `data-slot=command-shortcut`, so reaching for
                    the primitive is what puts the column against the edge.

                    `tracking-normal` undoes the wide letter-spacing that slot
                    carries for keycaps: right for `⌘K`, wrong for a path.
                  */}
                  <CommandShortcut className="mt-0.5 shrink-0 font-mono tracking-normal">
                    {destination.href === "/" ? "/" : destination.href.slice(1)}
                  </CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          ))}
        </CommandList>
      </Command>

      {/*
        Outside `Command`, which is `p-1`: the footer is chrome around the
        palette rather than a row in it, and inset by that padding its rule
        would stop short of both edges.
      */}
      <div className="text-muted-foreground flex items-center gap-4 border-t px-3 py-2.5 text-xs">
        <span className="flex items-center gap-1.5">
          <Kbd>↑</Kbd>
          <Kbd>↓</Kbd>
          Navigate
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>↵</Kbd>
          Open
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd>esc</Kbd>
          Close
        </span>
      </div>
    </CommandDialog>
  );
};
