import { useI18n } from "alepha/react/i18n";
import { useRouter } from "alepha/react/router";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../command/Command.tsx";
import { spotlightSearchText } from "./spotlightSearchText.ts";
import { type NavEntry, useNavEntries } from "./useNavEntries.ts";

export interface SpotlightProps {
  /**
   * Route name anchoring the palette — the same `root` passed to
   * {@link NavShell}. The palette lists the navigable pages of that subtree,
   * derived from each page's `nav` metadata (label / icon / group / keywords /
   * description). One source for sidebar, breadcrumbs and palette.
   */
  root: string;
  /**
   * Controlled open state. Omit to let the palette manage its own state (it
   * still toggles on the keyboard shortcut).
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Search input placeholder. Defaults to the localised `nav.spotlight.search`.
   */
  placeholder?: string;
  /**
   * Message shown when nothing matches the query. Defaults to the localised
   * `nav.spotlight.empty`.
   */
  emptyMessage?: ReactNode;
  /**
   * Bind the global ⌘K / Ctrl+K shortcut to toggle the palette. Defaults to
   * `true`.
   */
  shortcut?: boolean;
}

/**
 * Command palette over the navigation tree. Opens on ⌘K / Ctrl+K (or via
 * controlled `open`), searches page labels / keywords / descriptions, and
 * navigates on select. Reads the same {@link useNavEntries} source as the
 * sidebar, so it never drifts from the routes.
 */
export const Spotlight = (props: SpotlightProps) => {
  const { root, shortcut = true } = props;
  const router = useRouter<any>();
  const { tr } = useI18n();
  const entries = useNavEntries({ root });
  const placeholder =
    props.placeholder ?? tr("nav.spotlight.search", { default: "Search…" });

  const isControlled = props.open !== undefined;
  const [internalOpen, setInternalOpen] = useState(false);
  const open = isControlled ? !!props.open : internalOpen;

  const setOpen = useCallback(
    (next: boolean) => {
      if (!isControlled) setInternalOpen(next);
      props.onOpenChange?.(next);
    },
    [isControlled, props.onOpenChange],
  );

  useEffect(() => {
    if (!shortcut) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(!open);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [shortcut, open, setOpen]);

  // Bucket the already-sorted entries into their groups, preserving order.
  const groups = useMemo(() => {
    const out: SpotlightGroup[] = [];
    const byKey = new Map<string, NavEntry[]>();
    for (const entry of entries) {
      const key = entry.group ?? "";
      let items = byKey.get(key);
      if (!items) {
        items = [];
        byKey.set(key, items);
        out.push({
          key,
          label: entry.groupLabel || entry.group || undefined,
          items,
        });
      }
      items.push(entry);
    }
    return out;
  }, [entries]);

  const onSelect = useCallback(
    (entry: NavEntry) => {
      if (entry.disabled) return;
      setOpen(false);
      void router.push(entry.name);
    },
    [router, setOpen],
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title={tr("nav.spotlight.title", { default: "Search" })}
      description={tr("nav.spotlight.description", {
        default: "Jump to a page",
      })}
    >
      {/* Ranked by the command module's scorer over `spotlightSearchText`:
          the route name and label, then the description, `nav.keywords` and
          the section heading. */}
      <Command<NavEntry> items={groups} itemToStringValue={spotlightSearchText}>
        <CommandInput placeholder={placeholder} />
        <CommandEmpty>
          {props.emptyMessage ??
            tr("nav.spotlight.empty", { default: "No results." })}
        </CommandEmpty>
        <CommandList>
          {(group: SpotlightGroup) => (
            <CommandGroup
              key={group.key || "_ungrouped"}
              items={group.items}
              heading={group.label}
            >
              {(entry: NavEntry) => (
                <CommandItem
                  key={entry.name}
                  value={entry}
                  disabled={entry.disabled}
                  onClick={() => onSelect(entry)}
                >
                  {entry.icon}
                  <span>{entry.label}</span>
                  {entry.description ? (
                    <span className="text-muted-foreground ml-2 truncate text-xs">
                      {entry.description}
                    </span>
                  ) : null}
                </CommandItem>
              )}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
};

interface SpotlightGroup {
  [key: string]: unknown;
  key: string;
  label?: string;
  items: NavEntry[];
}
