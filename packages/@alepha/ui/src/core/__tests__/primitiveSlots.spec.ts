import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `data-slot` is a contract: `styles.css`, Tailwind's `data-[slot=…]`
 * variants and the apps (Lore's folio document, the showcase) all address a
 * primitive's parts by it. Renaming one breaks every one of those silently,
 * with the build and the types green.
 *
 * ⚠️ The slots are pinned by READING the source, not by rendering it. Every
 * popup part (`dialog-content`, `dropdown-menu-content`, `tooltip-content`,
 * ...) renders only while open, and jsdom cannot open one (#F1208), so a
 * rendered spec could pin the closed half of each family and nothing else.
 *
 * The list below is the contract. A slot added, renamed or removed fails here
 * until the list is edited on purpose, in the same change. `command` is left
 * out: it is Base UI's `Autocomplete` since #Q2186, with its own specs.
 */
describe("primitive data-slots", () => {
  const SRC = fileURLToPath(new URL("../..", import.meta.url));

  const PRIMITIVE_SLOTS: Record<string, string[]> = {
    "calendar/Calendar.tsx": ["calendar"],
    "calendar/LazyCalendar.tsx": ["calendar-fallback"],
    "chart/Chart.tsx": ["chart"],
    "core/Alert.tsx": [
      "alert",
      "alert-action",
      "alert-description",
      "alert-title",
    ],
    "core/AlertDialog.tsx": [
      "alert-dialog",
      "alert-dialog-action",
      "alert-dialog-cancel",
      "alert-dialog-content",
      "alert-dialog-description",
      "alert-dialog-footer",
      "alert-dialog-header",
      "alert-dialog-media",
      "alert-dialog-overlay",
      "alert-dialog-portal",
      "alert-dialog-title",
      "alert-dialog-trigger",
    ],
    "core/Avatar.tsx": [
      "avatar",
      "avatar-badge",
      "avatar-fallback",
      "avatar-group",
      "avatar-group-count",
      "avatar-image",
    ],
    "core/Badge.tsx": ["badge"],
    "core/Breadcrumb.tsx": [
      "breadcrumb",
      "breadcrumb-ellipsis",
      "breadcrumb-item",
      "breadcrumb-link",
      "breadcrumb-list",
      "breadcrumb-page",
      "breadcrumb-separator",
    ],
    "core/Button.tsx": ["button"],
    "core/ButtonGroup.tsx": [
      "button-group",
      "button-group-separator",
      "button-group-text",
    ],
    "core/Card.tsx": [
      "card",
      "card-action",
      "card-content",
      "card-description",
      "card-footer",
      "card-header",
      "card-title",
    ],
    "core/Checkbox.tsx": ["checkbox", "checkbox-indicator"],
    "core/Combobox.tsx": [
      "combobox-chip",
      "combobox-chip-input",
      "combobox-chip-remove",
      "combobox-chips",
      "combobox-clear",
      "combobox-collection",
      "combobox-content",
      "combobox-empty",
      "combobox-group",
      "combobox-item",
      "combobox-label",
      "combobox-list",
      "combobox-separator",
      "combobox-trigger",
      "combobox-value",
      "input-group-button",
    ],
    "core/ContextMenu.tsx": [
      "context-menu",
      "context-menu-checkbox-item",
      "context-menu-content",
      "context-menu-group",
      "context-menu-item",
      "context-menu-label",
      "context-menu-portal",
      "context-menu-radio-group",
      "context-menu-radio-item",
      "context-menu-separator",
      "context-menu-shortcut",
      "context-menu-sub",
      "context-menu-sub-content",
      "context-menu-sub-trigger",
      "context-menu-trigger",
    ],
    "core/Dialog.tsx": [
      "dialog",
      "dialog-close",
      "dialog-content",
      "dialog-description",
      "dialog-footer",
      "dialog-header",
      "dialog-overlay",
      "dialog-portal",
      "dialog-title",
      "dialog-trigger",
    ],
    "core/Drawer.tsx": [
      "drawer",
      "drawer-close",
      "drawer-content",
      "drawer-description",
      "drawer-footer",
      "drawer-header",
      "drawer-overlay",
      "drawer-popup",
      "drawer-portal",
      "drawer-swipe-handle",
      "drawer-title",
      "drawer-trigger",
      "drawer-viewport",
    ],
    "core/DropdownMenu.tsx": [
      "dropdown-menu",
      "dropdown-menu-checkbox-item",
      "dropdown-menu-checkbox-item-indicator",
      "dropdown-menu-content",
      "dropdown-menu-group",
      "dropdown-menu-item",
      "dropdown-menu-label",
      "dropdown-menu-portal",
      "dropdown-menu-radio-group",
      "dropdown-menu-radio-item",
      "dropdown-menu-radio-item-indicator",
      "dropdown-menu-separator",
      "dropdown-menu-shortcut",
      "dropdown-menu-sub",
      "dropdown-menu-sub-content",
      "dropdown-menu-sub-trigger",
      "dropdown-menu-trigger",
    ],
    "core/Empty.tsx": [
      "empty",
      "empty-content",
      "empty-description",
      "empty-header",
      "empty-icon",
      "empty-title",
    ],
    "core/HoverCard.tsx": [
      "hover-card",
      "hover-card-content",
      "hover-card-portal",
      "hover-card-trigger",
    ],
    "core/Input.tsx": ["input"],
    "core/InputGroup.tsx": [
      "input-group",
      "input-group-addon",
      "input-group-control",
    ],
    "core/Kbd.tsx": ["kbd", "kbd-group"],
    "core/Label.tsx": ["label"],
    "core/Menubar.tsx": [
      "menubar",
      "menubar-checkbox-item",
      "menubar-content",
      "menubar-group",
      "menubar-item",
      "menubar-label",
      "menubar-menu",
      "menubar-portal",
      "menubar-radio-group",
      "menubar-radio-item",
      "menubar-separator",
      "menubar-shortcut",
      "menubar-sub",
      "menubar-sub-content",
      "menubar-sub-trigger",
      "menubar-trigger",
    ],
    "core/Pagination.tsx": [
      "pagination",
      "pagination-content",
      "pagination-ellipsis",
      "pagination-item",
      "pagination-link",
    ],
    "core/Popover.tsx": [
      "popover",
      "popover-content",
      "popover-description",
      "popover-header",
      "popover-title",
      "popover-trigger",
    ],
    "core/Progress.tsx": [
      "progress",
      "progress-indicator",
      "progress-label",
      "progress-track",
      "progress-value",
    ],
    "core/Segmented.tsx": [
      "segmented",
      "segmented-count",
      "segmented-item",
      "segmented-thumb",
    ],
    "core/Separator.tsx": ["separator"],
    "core/Sheet.tsx": [
      "sheet",
      "sheet-close",
      "sheet-content",
      "sheet-description",
      "sheet-footer",
      "sheet-header",
      "sheet-overlay",
      "sheet-portal",
      "sheet-title",
      "sheet-trigger",
    ],
    "core/Sidebar.tsx": [
      "sidebar",
      "sidebar-container",
      "sidebar-content",
      "sidebar-footer",
      "sidebar-gap",
      "sidebar-group",
      "sidebar-group-action",
      "sidebar-group-content",
      "sidebar-group-label",
      "sidebar-header",
      "sidebar-inner",
      "sidebar-input",
      "sidebar-inset",
      "sidebar-menu",
      "sidebar-menu-action",
      "sidebar-menu-badge",
      "sidebar-menu-button",
      "sidebar-menu-item",
      "sidebar-menu-skeleton",
      "sidebar-menu-sub",
      "sidebar-menu-sub-button",
      "sidebar-menu-sub-item",
      "sidebar-rail",
      "sidebar-separator",
      "sidebar-trigger",
      "sidebar-wrapper",
    ],
    "core/Skeleton.tsx": ["skeleton"],
    "core/Slider.tsx": [
      "slider",
      "slider-range",
      "slider-thumb",
      "slider-track",
    ],
    "core/Spinner.tsx": ["spinner"],
    "core/Switch.tsx": ["switch", "switch-thumb"],
    "core/Table.tsx": [
      "table",
      "table-body",
      "table-caption",
      "table-cell",
      "table-container",
      "table-footer",
      "table-head",
      "table-header",
      "table-row",
    ],
    "core/Tabs.tsx": ["tabs", "tabs-content", "tabs-list", "tabs-trigger"],
    "core/Textarea.tsx": ["textarea"],
    "core/Tooltip.tsx": [
      "tooltip",
      "tooltip-content",
      "tooltip-provider",
      "tooltip-trigger",
    ],
    "otp/InputOTP.tsx": [
      "input-otp",
      "input-otp-group",
      "input-otp-separator",
      "input-otp-slot",
    ],
    "resizable/Resizable.tsx": [
      "resizable-handle",
      "resizable-panel",
      "resizable-panel-group",
    ],
  };

  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? walk(path) : [path];
    });

  const isSpec = (file: string) =>
    /\.spec\.tsx?$/.test(file) || file.includes("/__tests__/");

  const sources = walk(SRC)
    .filter((file) => /\.(tsx?|css)$/.test(file))
    .map((file) => relative(SRC, file));

  /**
   * The file with its comments removed, so prose about a slot is neither a
   * write nor a selector. A `//` right after a colon is left alone: that is a
   * URL inside a string, not a comment.
   */
  const code = (file: string): string =>
    readFileSync(join(SRC, file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

  /**
   * Every slot a file writes: a JSX `data-slot="…"`, an object's
   * `"data-slot": "…"`, and `slot: "…"`, which is how a `useRender` part
   * (`Badge`, `ButtonGroupText`, the sidebar's buttons) names its slot.
   */
  const slotsWrittenBy = (file: string): string[] => {
    const source = code(file);
    const found = [
      ...source.matchAll(/data-slot="([a-z0-9-]+)"/g),
      ...source.matchAll(/"data-slot":\s*"([a-z0-9-]+)"/g),
      ...source.matchAll(/\bslot:\s*"([a-z0-9-]+)"/g),
    ].map((match) => match[1] as string);
    return [...new Set(found)].sort();
  };

  it("pins every data-slot the primitives write", () => {
    const primitives = sources.filter(
      (file) =>
        /^(core|chart|calendar|otp|resizable)\/[^/]+\.tsx$/.test(file) &&
        !isSpec(file),
    );
    const actual: Record<string, string[]> = {};
    for (const file of primitives.sort()) {
      const slots = slotsWrittenBy(file);
      if (slots.length > 0) actual[file] = slots;
    }

    expect(actual).toEqual(PRIMITIVE_SLOTS);
  });

  /**
   * The other direction, inside the package: a selector that names a slot no
   * component writes is dead, and nothing else notices. On the tree #Q2184
   * started from it caught `ButtonGroup`'s `select-trigger`, a slot only the
   * deleted `Select` wrote. Apps are out of scope here: Lore targets slots of
   * its own.
   */
  it("finds no selector naming a slot that nothing in the package writes", () => {
    const written = new Set(
      sources
        .filter((file) => /\.tsx?$/.test(file) && !isSpec(file))
        .flatMap(slotsWrittenBy),
    );
    const dangling: string[] = [];
    for (const file of sources.filter((it) => !isSpec(it))) {
      for (const match of code(file).matchAll(
        /data-\[slot=([a-z0-9-]+)\]|\[data-slot=["']?([a-z0-9-]+)["']?\]/g,
      )) {
        const slot = (match[1] ?? match[2]) as string;
        if (!written.has(slot)) dangling.push(`${file}: ${slot}`);
      }
    }

    expect(dangling).toEqual([]);
  });
});
