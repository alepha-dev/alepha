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
    }
  });

  it("has a FR string for every key EN has", () => {
    const fr = frDictionary as Record<string, unknown>;
    for (const menu of FOLIO_MENUS) {
      expect(fr[menu.labelKey], menu.labelKey).toBeTruthy();
    }
    for (const item of folioMenuItems()) {
      expect(fr[item.labelKey], item.labelKey).toBeTruthy();
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
        /^(mod\+)?(shift\+)?(alt\+)?[a-z0-9.]+$/,
      );
    }
  });
});

describe("isFolioActionEnabled", () => {
  const unlocked = { locked: false, isNew: false, dirty: true };

  it("enables everything on an unlocked saved folio", () => {
    for (const item of folioMenuItems()) {
      expect(isFolioActionEnabled(item.id, unlocked), item.id).toBe(true);
    }
  });

  it("disables editing actions while the folio is locked", () => {
    const locked = { locked: true, isNew: false, dirty: false };
    expect(isFolioActionEnabled("edit.bold", locked)).toBe(false);
    expect(isFolioActionEnabled("insert.table", locked)).toBe(false);
    expect(isFolioActionEnabled("folio.save", locked)).toBe(false);
  });

  it("keeps pane toggles usable while locked", () => {
    const locked = { locked: true, isNew: false, dirty: false };
    expect(isFolioActionEnabled("view.tree", locked)).toBe(true);
    expect(isFolioActionEnabled("view.inspector", locked)).toBe(true);
    expect(isFolioActionEnabled("folio.delete", locked)).toBe(true);
  });

  it("disables history, duplicate and export on an unsaved folio", () => {
    const fresh = { locked: false, isNew: true, dirty: true };
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

  it("every binding has a shortcut display form", () => {
    for (const item of folioMenuItems()) {
      if (item.binding) {
        expect(
          item.shortcut,
          `${item.id} has binding but no shortcut display`,
        ).toBeDefined();
      }
    }
  });

  it("modifier shortcuts with ⌘ or ⌧ have bindings", () => {
    for (const item of folioMenuItems()) {
      if (
        item.shortcut &&
        (item.shortcut.includes("⌘") || item.shortcut.includes("⌧"))
      ) {
        expect(
          item.binding,
          `${item.id} has modifier shortcut "${item.shortcut}" but no binding`,
        ).toBeDefined();
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

  it("folio.newDirectory has no shortcut", () => {
    const item = folioMenuItems().find((i) => i.id === "folio.newDirectory");
    expect(item?.shortcut).toBeUndefined();
    expect(item?.binding).toBeUndefined();
  });

  it("edit.wikiLink has shortcut but no binding", () => {
    const item = folioMenuItems().find((i) => i.id === "edit.wikiLink");
    expect(item?.shortcut).toBe("[[");
    expect(item?.binding).toBeUndefined();
  });

  it("all insert actions without shortcuts have no bindings", () => {
    for (const item of folioMenuItems()) {
      if (
        item.id.startsWith("insert.") &&
        item.id !== "insert.image" &&
        item.id !== "insert.table"
      ) {
        if (!item.shortcut) {
          expect(
            item.binding,
            `${item.id} has unexpected binding`,
          ).toBeUndefined();
        }
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
});
