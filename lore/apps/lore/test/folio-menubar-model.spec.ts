import { describe, expect, it } from "vitest";
import {
  FOLIO_MENUS,
  folioMenuItems,
  folioShortcutBindings,
  isFolioActionEnabled,
} from "@/web/app/components/folios/editor/menubar/folioMenubarModel.ts";
import enDictionary from "@/web/locales/en.ts";
import frDictionary from "@/web/locales/fr.ts";

describe("FOLIO_MENUS", () => {
  it("declares the five menus in the designed order", () => {
    expect(FOLIO_MENUS.map((m) => m.id)).toEqual([
      "folio",
      "edit",
      "insert",
      "view",
      "history",
    ]);
  });

  it("never starts or ends a menu with a separator", () => {
    for (const menu of FOLIO_MENUS) {
      expect("separator" in menu.entries[0]).toBe(false);
      expect("separator" in menu.entries[menu.entries.length - 1]).toBe(false);
    }
  });

  it("gives every item a unique action id", () => {
    const ids = folioMenuItems().map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("i18n coverage", () => {
  it("has an EN string for every menu and item label key", () => {
    const en = enDictionary as Record<string, unknown>;
    for (const menu of FOLIO_MENUS) {
      expect(en[menu.labelKey], menu.labelKey).toBeTruthy();
    }
    for (const item of folioMenuItems()) {
      expect(en[item.labelKey], item.labelKey).toBeTruthy();
      if (item.alternateLabelKey) {
        expect(en[item.alternateLabelKey], item.alternateLabelKey).toBeTruthy();
      }
    }
  });

  it("has a FR string for every key EN has", () => {
    const fr = frDictionary as Record<string, unknown>;
    for (const menu of FOLIO_MENUS) {
      expect(fr[menu.labelKey], menu.labelKey).toBeTruthy();
    }
    for (const item of folioMenuItems()) {
      expect(fr[item.labelKey], item.labelKey).toBeTruthy();
      if (item.alternateLabelKey) {
        expect(fr[item.alternateLabelKey], item.alternateLabelKey).toBeTruthy();
      }
    }
  });
});

describe("folioShortcutBindings", () => {
  it("maps every declared binding to exactly one action", () => {
    const bindings = folioShortcutBindings();
    const declared = folioMenuItems().filter((i) => i.binding);
    expect(bindings.size).toBe(declared.length);
  });

  it("has no duplicate bindings across menus", () => {
    const declared = folioMenuItems()
      .map((i) => i.binding)
      .filter((b): b is string => !!b);
    expect(new Set(declared).size).toBe(declared.length);
  });

  it("binds save to mod+s", () => {
    expect(folioShortcutBindings().get("mod+s")).toBe("folio.save");
  });

  it("uses the normalized binding grammar", () => {
    for (const item of folioMenuItems()) {
      if (!item.binding) continue;
      expect(item.binding, item.id).toMatch(
        /^(mod\+)?(shift\+)?(alt\+)?[a-z0-9.\\]+$/,
      );
    }
  });
});

describe("isFolioActionEnabled", () => {
  const unlocked = {
    locked: false,
    isNew: false,
    dirty: true,
    isProtected: false,
    isPinned: false,
  };

  it("enables everything on an unlocked saved folio in Edit mode", () => {
    for (const item of folioMenuItems()) {
      expect(
        isFolioActionEnabled(item.id, { ...unlocked, editing: true }),
        item.id,
      ).toBe(true);
    }
  });

  it("disables the formatting actions in View mode, and only those", () => {
    // They edit the document text, so they need CodeMirror mounted. Every
    // other action — save, pin, export, the pane toggles, find — acts on
    // the folio or the workspace and stays live while reading.
    const reading = { ...unlocked, editing: false };
    for (const item of folioMenuItems()) {
      const needsEditor = /^(edit\.(bold|italic|code)|insert\.)/.test(item.id);
      expect(isFolioActionEnabled(item.id, reading), item.id).toBe(
        !needsEditor,
      );
    }
  });

  it("disables editing actions while the folio is locked", () => {
    const locked = {
      locked: true,
      isNew: false,
      dirty: false,
      isProtected: false,
      isPinned: false,
    };
    // `view.mode` carries what `edit.bold` / `insert.table` used to assert
    // here: it is the id that means "act on the body", and a locked folio's
    // body is ciphertext. The formatting ids were deleted with the editor
    // realm that published them.
    expect(isFolioActionEnabled("view.mode", locked)).toBe(false);
    expect(isFolioActionEnabled("folio.save", locked)).toBe(false);
  });

  it("keeps pane toggles usable while locked", () => {
    const locked = {
      locked: true,
      isNew: false,
      dirty: false,
      isProtected: false,
      isPinned: false,
    };
    expect(isFolioActionEnabled("view.tree", locked)).toBe(true);
    expect(isFolioActionEnabled("view.inspector", locked)).toBe(true);
    expect(isFolioActionEnabled("folio.delete", locked)).toBe(true);
  });

  it("disables history, duplicate and export on an unsaved folio", () => {
    const fresh = {
      locked: false,
      isNew: true,
      dirty: true,
      isProtected: false,
      isPinned: false,
    };
    expect(isFolioActionEnabled("history.revisions", fresh)).toBe(false);
    expect(isFolioActionEnabled("folio.duplicate", fresh)).toBe(false);
    expect(isFolioActionEnabled("folio.export", fresh)).toBe(false);
    expect(isFolioActionEnabled("folio.save", fresh)).toBe(true);
  });
});

describe("comprehensive menu coverage", () => {
  it("every action appears in exactly one menu", () => {
    const allMenuItems = folioMenuItems();
    const ids = new Set<string>();
    for (const item of allMenuItems) {
      expect(ids.has(item.id), `${item.id} appears more than once`).toBe(false);
      ids.add(item.id);
    }
  });

  it("pairs every key-chord glyph with a binding, and no syntax hint with one", () => {
    for (const item of folioMenuItems()) {
      expect(!!item.shortcut, `${item.id}: shortcut without binding`).toBe(
        !!item.binding,
      );
      if (item.syntaxHint) {
        expect(
          item.binding,
          `${item.id}: syntax hint must not bind`,
        ).toBeUndefined();
      }
    }
  });

  it("only delete has the danger flag", () => {
    for (const item of folioMenuItems()) {
      if (item.danger) {
        expect(item.id).toBe("folio.delete");
      }
    }
  });

  it("actions without shortcuts or syntax hints can have no binding", () => {
    for (const item of folioMenuItems()) {
      if (!item.shortcut && !item.syntaxHint) {
        expect(
          item.binding,
          `${item.id} should not have a binding`,
        ).toBeUndefined();
      }
    }
  });

  it("availableWhenLocked actions are navigational, pane-toggles, or destructive", () => {
    const lockedItems = folioMenuItems().filter((i) => i.availableWhenLocked);
    const navigationOrToggleOrDestructive = new Set([
      "folio.new",
      "folio.newDirectory",
      "folio.move",
      "folio.pin",
      "folio.delete",
      "edit.find",
      "view.rich",
      "view.source",
      "view.tree",
      "view.inspector",
      "view.focus",
    ]);
    for (const item of lockedItems) {
      expect(
        navigationOrToggleOrDestructive.has(item.id),
        `${item.id} is marked availableWhenLocked but is neither navigation nor pane-toggle nor destructive`,
      ).toBe(true);
    }
  });

  it("each menu has a distinct id", () => {
    const menuIds = FOLIO_MENUS.map((m) => m.id);
    expect(new Set(menuIds).size).toBe(menuIds.length);
  });

  it("each menu has a labelKey that starts with folios.editor.menu", () => {
    for (const menu of FOLIO_MENUS) {
      expect(menu.labelKey).toMatch(/^folios\.editor\.menu\./);
    }
  });

  it("each menu action has a labelKey that starts with folios.editor.action", () => {
    for (const item of folioMenuItems()) {
      expect(item.labelKey).toMatch(/^folios\.editor\.action\./);
    }
  });

  it("never advertises a shortcut glyph without a live binding", () => {
    for (const item of folioMenuItems()) {
      if (!item.shortcut) continue;
      // Shortcuts with modifier symbols (⌘, ⌧, ⇧) must have bindings
      const hasModifierSymbol =
        item.shortcut.includes("⌘") || item.shortcut.includes("⇧");
      if (hasModifierSymbol) {
        expect(
          item.binding,
          `${item.id} has modifier shortcut but no binding`,
        ).toBeDefined();
      }
      // Raw keys like [[, ##, -, etc. don't need bindings (intentional)
    }
  });

  it("binds nothing the browser chrome reserves", () => {
    const reserved = new Set([
      "mod+n",
      "mod+t",
      "mod+w",
      "mod+1",
      "mod+2",
      "mod+3",
    ]);
    for (const item of folioMenuItems()) {
      if (item.binding) {
        expect(reserved.has(item.binding), item.id).toBe(false);
      }
    }
  });

  it("gates row-scoped actions on isNew before consulting locked", () => {
    // {isNew:true, locked:false} is the state that distinguishes the two branch
    // orders; with locked:true both orders return false and the test proves nothing.
    const fresh = {
      locked: false,
      isNew: true,
      dirty: true,
      isProtected: false,
      isPinned: false,
    };
    for (const id of ["folio.delete", "folio.move", "folio.pin"] as const) {
      expect(isFolioActionEnabled(id, fresh), id).toBe(false);
    }
  });

  it("swaps a toggle's label when its subject is already in the 'on' state", () => {
    const clear = {
      locked: false,
      isNew: false,
      dirty: false,
      isProtected: false,
      isPinned: false,
    };
    const on = {
      locked: false,
      isNew: false,
      dirty: false,
      isProtected: true,
      isPinned: true,
    };
    for (const [id, state] of [
      ["folio.encrypt", on],
      ["folio.pin", on],
    ] as const) {
      const item = folioMenuItems().find((i) => i.id === id)!;
      expect(item.alternateLabelKey, id).toBeDefined();
      // Both remain ENABLED in the "on" state — the label changes, not availability.
      expect(isFolioActionEnabled(id, state), id).toBe(true);
      expect(isFolioActionEnabled(id, clear), id).toBe(true);
    }
  });

  it("pin toggle action has alternate label for pinned state", () => {
    const pin = folioMenuItems().find((i) => i.id === "folio.pin");
    expect(pin?.alternateLabelKey).toBeDefined();
  });

  it("encrypt toggle action has alternate label for protected state", () => {
    const encrypt = folioMenuItems().find((i) => i.id === "folio.encrypt");
    expect(encrypt?.alternateLabelKey).toBeDefined();
  });
});

describe("folioMenubarModel - the diagram starter (#1261)", () => {
  const saved = {
    locked: false,
    isNew: false,
    dirty: true,
    isProtected: false,
    isPinned: false,
  };

  it("offers an Insert > Diagram action", () => {
    expect(folioMenuItems().map((i) => i.id)).toContain("insert.diagram");
  });

  it("needs edit mode, like every other text-inserting action", () => {
    expect(
      isFolioActionEnabled("insert.diagram", { ...saved, editing: true }),
    ).toBe(true);
    expect(
      isFolioActionEnabled("insert.diagram", { ...saved, editing: false }),
    ).toBe(false);
  });
});
