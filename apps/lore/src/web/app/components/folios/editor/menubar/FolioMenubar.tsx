import { Button } from "@alepha/ui/components/ui/button";
import {
  Menubar,
  MenubarContent,
  MenubarItem,
  MenubarMenu,
  MenubarSeparator,
  MenubarShortcut,
  MenubarTrigger,
} from "@alepha/ui/components/ui/menubar";
import { useI18n } from "alepha/react/i18n";
import type { ReactElement } from "react";

import type { I18n } from "../../../../services/I18n.ts";
import type { FolioActionHandlers } from "../useFolioActions.ts";
import {
  FOLIO_MENUS,
  type FolioActionState,
  type FolioMenuItem,
  isFolioActionEnabled,
} from "./folioMenubarModel.ts";

export interface FolioMenubarProps {
  handlers: FolioActionHandlers;
  state: FolioActionState;
  /**
   * True while `folio.save`'s request is in flight. Only reaches the button in
   * create mode, which is the only state that still renders one.
   */
  saving?: boolean;
  /**
   * Whether the draft differs from what is stored. Save is pointless
   * otherwise, and an always-enabled Save button invites the reader to
   * press it for no reason.
   */
  dirty?: boolean;
}

/**
 * The Folio / Edit / View / History menubar. Renders `FOLIO_MENUS` as-is —
 * labels, shortcuts, syntax hints and per-state availability all come from
 * that model; nothing here restates them.
 *
 * There used to be two of these, mounted in contexts that did not share a
 * realm: a wrapper inside MDXEditor's `renderToolbar` (the only place the
 * `edit.*` / `insert.*` dispatchers could be built) and this one, on the
 * empty `/folios` state where no editor is mounted at all. With the
 * formatting commands deleted there is one mount point, no wrapper and no
 * realm — every remaining action is plain app state.
 */
const FolioMenubar = (props: FolioMenubarProps): ReactElement => {
  const { tr } = useI18n<I18n, "en">();

  const dispatch = (id: FolioMenuItem["id"]): void => {
    void props.handlers[id]();
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
    return false;
  };

  // 34px, one subtle step off the card, as the design has it — expressed
  // with the theme's own tokens rather than the mockup's raw oklch values,
  // which are dark-only where Lore ships both modes.
  return (
    <div
      data-slot="folio-menubar"
      className="border-border bg-muted/40 flex h-[34px] flex-none items-center border-b pr-3 pl-2.5"
    >
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
      {/* Save survives in CREATE MODE ONLY, and the status line not at all.
          Editing a folio that exists is auto-saved (`useFolioAutoSave`: 1.5s
          after typing stops, plus once more on the way out), so a button and a
          "not saved yet" line were both reporting on a problem the reader no
          longer has.

          Create mode is the one state autosave deliberately does not cover —
          `enabled: !!props.folio`, so a folio does not spring into existence on
          the first keystroke. Removing the button there too would leave a new
          folio with no visible way to save at all: ⌘S and Folio▸Save would
          still work, which is not the same as being findable. That exact
          regression has shipped here once before. */}
      {props.state.isNew && (
        <Button
          type="button"
          size="xs"
          disabled={
            !isFolioActionEnabled("folio.save", props.state) ||
            props.saving ||
            !props.dirty
          }
          onClick={() => dispatch("folio.save")}
        >
          {tr("folios.editor.action.save")}
        </Button>
      )}
    </div>
  );
};

export default FolioMenubar;
