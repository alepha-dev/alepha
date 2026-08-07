import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger,
} from "@alepha/ui/components/ui/menubar";
import { DateTimeProvider } from "alepha/datetime";
import { useInject } from "alepha/react";
import { useI18n } from "alepha/react/i18n";
import { type ReactElement, useEffect } from "react";
import type { I18n } from "../../../../services/I18n.ts";
import type { FolioActionHandlers } from "../useFolioActions.ts";
import {
  FOLIO_MENUS,
  type FolioActionState,
  type FolioMenuItem,
  isFolioActionEnabled,
} from "./folioMenubarModel.ts";
import { useEditorRealmCommands } from "./useEditorRealmCommands.ts";

export interface FolioMenubarProps {
  handlers: FolioActionHandlers;
  state: FolioActionState;
  /**
   * Whether an image upload handler is actually wired (`false` for a
   * protected folio — see `useFolioImageUpload`'s doc). `folioMenubarModel`
   * has no per-plugin concept, so `insert.image` needs this extra,
   * targeted disable on top of `isFolioActionEnabled` — mirrors
   * `MarkdownEditorInner`'s own `withImages` gate on the default toolbar's
   * Insert Image button.
   */
  hasImageUpload: boolean;
  /**
   * Hands the real MDXEditor realm-command dispatchers this component
   * computes (`useEditorRealmCommands`) back up to `useFolioActions`, so
   * that hook's `handlers` — used for BOTH this menu's own clicks and the
   * single, always-mounted `useFolioShortcuts` binding in `FolioDocument`
   * — can actually reach them. See `useFolioActions.ts`'s doc on
   * `editorCommandsRef` for the full reasoning.
   */
  onEditorCommands: (commands: Partial<FolioActionHandlers>) => void;
  /**
   * The save-state line, right-aligned on this row. It lives here rather
   * than on the toolbar because that is where the design puts it — the
   * toolbar's own copy is gated behind `showDocActions`, which the shipped
   * mockup state turns off.
   */
  statusKey: "draft" | "saved" | "unsaved";
  savedAt?: string;
}

/**
 * The Folio / Edit / Insert / View / History menubar. Renders `FOLIO_MENUS`
 * (Task 4) as-is — labels, shortcuts, syntax hints and per-state
 * availability all come from that model; nothing here restates them.
 *
 * Mounts through `MarkdownEditor`'s `renderToolbar`
 * (`MarkdownEditorInner.tsx`), i.e. INSIDE MDXEditor's realm provider —
 * the only place `useEditorRealmCommands`'s `usePublisher`/`useCellValue`
 * calls can resolve. `FolioToolbar`, its sibling in the same
 * `renderToolbar` output, mounts the same way for the same reason.
 */
const FolioMenubar = (props: FolioMenubarProps): ReactElement => {
  const { tr } = useI18n<I18n, "en">();
  const dt = useInject(DateTimeProvider);
  const editorCommands = useEditorRealmCommands();

  // `onReady`/`editorCommands` change identity every render (neither is
  // memoized — cheap to recompute, not worth a `useMemo`/`useCallback`
  // pair just to skip a plain object assignment), so this effect re-runs
  // every render too. That is fine: the assignment itself is free, and
  // running it via `useEffect` — rather than during render, the way
  // `MarkdownEditorInner.tsx`'s `renderToolbarRef` has to — is safe here
  // specifically because nothing reads `editorCommandsRef` synchronously
  // within the SAME render pass; it's only ever read later, from a click
  // or keydown handler, by which point any commit strategy has already
  // flushed. The cleanup clears the ref on unmount (the folio locks, or
  // this folio's session ends) so a stale dispatcher — closed over an
  // editor instance MDXEditor is about to tear down — can never fire.
  useEffect(() => {
    props.onEditorCommands(editorCommands);
    return () => props.onEditorCommands({});
  }, [editorCommands, props]);

  const dispatch = (id: FolioMenuItem["id"]): void => {
    props.handlers[id]();
  };

  const labelKeyFor = (item: FolioMenuItem): string => {
    if (!item.alternateLabelKey) return item.labelKey;
    if (item.id === "folio.pin" && props.state.isPinned) {
      return item.alternateLabelKey;
    }
    if (item.id === "folio.encrypt" && props.state.isProtected) {
      return item.alternateLabelKey;
    }
    return item.labelKey;
  };

  const isDisabled = (item: FolioMenuItem): boolean => {
    if (!isFolioActionEnabled(item.id, props.state)) return true;
    if (item.id === "insert.image" && !props.hasImageUpload) return true;
    return false;
  };

  const statusLabel =
    props.statusKey === "saved" && props.savedAt
      ? tr("folios.editor.status.saved", {
          args: [String(dt.of(props.savedAt).fromNow())],
        })
      : tr(`folios.editor.status.${props.statusKey}`);

  // 34px, one subtle step off the card, as the design has it — expressed
  // with the theme's own tokens rather than the mockup's raw oklch values,
  // which are dark-only where Lore ships both modes.
  return (
    <div className="border-border bg-muted/40 flex h-[34px] flex-none items-center border-b pr-3 pl-2.5">
      <Menubar className="h-auto gap-0.5 rounded-none border-none bg-transparent p-0">
        {FOLIO_MENUS.map((menu) => (
          <MenubarMenu key={menu.id}>
            <MenubarTrigger>{tr(menu.labelKey)}</MenubarTrigger>
            <MenubarContent>
              {menu.entries.map((entry, index) =>
                "separator" in entry ? (
                  <MenubarSeparator key={`sep-${index}`} />
                ) : (
                  <MenubarItem
                    key={entry.id}
                    variant={entry.danger ? "destructive" : "default"}
                    disabled={isDisabled(entry)}
                    onClick={() => dispatch(entry.id)}
                  >
                    {tr(labelKeyFor(entry))}
                    {(entry.shortcut ?? entry.syntaxHint) && (
                      <MenubarShortcut>
                        {entry.shortcut ?? entry.syntaxHint}
                      </MenubarShortcut>
                    )}
                  </MenubarItem>
                ),
              )}
            </MenubarContent>
          </MenubarMenu>
        ))}
      </Menubar>
      <div className="flex-1" />
      <span className="text-muted-foreground text-[11.5px] whitespace-nowrap">
        {statusLabel}
      </span>
    </div>
  );
};

export default FolioMenubar;
