import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@alepha/ui/components/ui/command";
import { useRouter } from "alepha/react/router";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { type NavEntry, useNavEntries } from "./use-nav-entries.ts";

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
   * Search input placeholder.
   */
  placeholder?: string;
  /**
   * Message shown when nothing matches the query.
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
  const { root, placeholder = "Search…", shortcut = true } = props;
  const router = useRouter<any>();
  const entries = useNavEntries({ root });

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
    const out: { key: string; label?: string; items: NavEntry[] }[] = [];
    const byKey = new Map<string, NavEntry[]>();
    for (const entry of entries) {
      const key = entry.group ?? "";
      let items = byKey.get(key);
      if (!items) {
        items = [];
        byKey.set(key, items);
        out.push({ key, label: entry.group || undefined, items });
      }
      items.push(entry);
    }
    return out;
  }, [entries]);

  const onSelect = useCallback(
    (entry: NavEntry) => {
      if (entry.disabled) return;
      setOpen(false);
      router.push(entry.name);
    },
    [router, setOpen],
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="Search"
      description="Jump to a page"
    >
      <Command>
        <CommandInput placeholder={placeholder} />
        <CommandList>
          <CommandEmpty>{props.emptyMessage ?? "No results."}</CommandEmpty>
          {groups.map((group) => (
            <CommandGroup key={group.key || "_ungrouped"} heading={group.label}>
              {group.items.map((entry) => (
                <CommandItem
                  key={entry.name}
                  // cmdk matches the query against `value` + `keywords`;
                  // include the human label plus any explicit synonyms.
                  value={`${entry.name} ${toText(entry.label)}`}
                  keywords={[
                    toText(entry.label),
                    toText(entry.description),
                    ...(entry.keywords ?? []),
                    entry.group ?? "",
                  ].filter(Boolean)}
                  disabled={entry.disabled}
                  onSelect={() => onSelect(entry)}
                >
                  {entry.icon}
                  <span>{entry.label}</span>
                  {entry.description ? (
                    <span className="text-muted-foreground ml-2 truncate text-xs">
                      {entry.description}
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

/**
 * cmdk filters on plain text; coerce a ReactNode label to a searchable string
 * (component labels contribute nothing — callers should add `nav.keywords`).
 */
function toText(node: ReactNode): string {
  return typeof node === "string" || typeof node === "number"
    ? String(node)
    : "";
}
