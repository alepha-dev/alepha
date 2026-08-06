/**
 * Every action the folio workspace menubar, toolbar and keyboard can
 * trigger. One flat union so a handler map is exhaustive-checkable.
 */
export type FolioActionId =
  | "folio.new"
  | "folio.newDirectory"
  | "folio.save"
  | "folio.duplicate"
  | "folio.move"
  | "folio.pin"
  | "folio.export"
  | "folio.encrypt"
  | "folio.delete"
  | "edit.undo"
  | "edit.redo"
  | "edit.bold"
  | "edit.italic"
  | "edit.code"
  | "edit.link"
  | "edit.wikiLink"
  | "edit.find"
  | "insert.heading"
  | "insert.bulletList"
  | "insert.numberedList"
  | "insert.taskList"
  | "insert.quote"
  | "insert.image"
  | "insert.table"
  | "insert.codeBlock"
  | "insert.divider"
  | "view.rich"
  | "view.source"
  | "view.tree"
  | "view.inspector"
  | "view.focus"
  | "history.revisions"
  | "history.compare"
  | "history.restore"
  | "history.keep";

export interface FolioMenuItem {
  id: FolioActionId;
  labelKey: string;
  /**
   * Display form shown right-aligned in the menu, e.g. `⌘S`.
   */
  shortcut?: string;
  /**
   * Normalized binding the keyboard handler matches against: lowercase,
   * `+`-joined, modifiers ordered `mod`, `shift`, `alt`. `mod` is ⌘ on
   * macOS and Ctrl elsewhere.
   */
  binding?: string;
  danger?: boolean;
  /**
   * Stays usable while the folio is protected and still locked. Only
   * navigation, pane toggles and destructive folio-level actions qualify —
   * nothing that would write to a body the user cannot read.
   */
  availableWhenLocked?: boolean;
}

export type FolioMenuEntry = FolioMenuItem | { separator: true };

export interface FolioMenu {
  id: string;
  labelKey: string;
  entries: FolioMenuEntry[];
}

const sep = { separator: true } as const;

/**
 * The five menus, in the order the design lays them out. This is the
 * single source of truth: `FolioMenubar` renders it, `useFolioShortcuts`
 * binds from it, so a label and its shortcut cannot drift apart.
 */
export const FOLIO_MENUS: FolioMenu[] = [
  {
    id: "folio",
    labelKey: "folios.editor.menu.folio",
    entries: [
      {
        id: "folio.new",
        labelKey: "folios.editor.action.new",
        shortcut: "⌘N",
        binding: "mod+n",
        availableWhenLocked: true,
      },
      {
        id: "folio.newDirectory",
        labelKey: "folios.editor.action.new-directory",
        availableWhenLocked: true,
      },
      sep,
      {
        id: "folio.save",
        labelKey: "folios.editor.action.save",
        shortcut: "⌘S",
        binding: "mod+s",
      },
      {
        id: "folio.duplicate",
        labelKey: "folios.editor.action.duplicate",
        shortcut: "⌘D",
        binding: "mod+d",
      },
      {
        id: "folio.move",
        labelKey: "folios.editor.action.move",
        availableWhenLocked: true,
      },
      {
        id: "folio.pin",
        labelKey: "folios.editor.action.pin",
        availableWhenLocked: true,
      },
      sep,
      { id: "folio.export", labelKey: "folios.editor.action.export" },
      { id: "folio.encrypt", labelKey: "folios.editor.action.encrypt" },
      sep,
      {
        id: "folio.delete",
        labelKey: "folios.editor.action.delete",
        shortcut: "⌫",
        danger: true,
        availableWhenLocked: true,
      },
    ],
  },
  {
    id: "edit",
    labelKey: "folios.editor.menu.edit",
    entries: [
      {
        id: "edit.undo",
        labelKey: "folios.editor.action.undo",
        shortcut: "⌘Z",
        binding: "mod+z",
      },
      {
        id: "edit.redo",
        labelKey: "folios.editor.action.redo",
        shortcut: "⇧⌘Z",
        binding: "mod+shift+z",
      },
      sep,
      {
        id: "edit.bold",
        labelKey: "folios.editor.action.bold",
        shortcut: "⌘B",
        binding: "mod+b",
      },
      {
        id: "edit.italic",
        labelKey: "folios.editor.action.italic",
        shortcut: "⌘I",
        binding: "mod+i",
      },
      {
        id: "edit.code",
        labelKey: "folios.editor.action.code",
        shortcut: "⌘E",
        binding: "mod+e",
      },
      sep,
      {
        id: "edit.link",
        labelKey: "folios.editor.action.link",
        shortcut: "⌘K",
        binding: "mod+k",
      },
      {
        id: "edit.wikiLink",
        labelKey: "folios.editor.action.wiki-link",
        shortcut: "[[",
      },
      sep,
      {
        id: "edit.find",
        labelKey: "folios.editor.action.find",
        shortcut: "⌘F",
        binding: "mod+f",
        availableWhenLocked: true,
      },
    ],
  },
  {
    id: "insert",
    labelKey: "folios.editor.menu.insert",
    entries: [
      {
        id: "insert.heading",
        labelKey: "folios.editor.action.heading",
        shortcut: "##",
      },
      {
        id: "insert.bulletList",
        labelKey: "folios.editor.action.bullet-list",
        shortcut: "-",
      },
      {
        id: "insert.numberedList",
        labelKey: "folios.editor.action.numbered-list",
        shortcut: "1.",
      },
      {
        id: "insert.taskList",
        labelKey: "folios.editor.action.task-list",
        shortcut: "[]",
      },
      {
        id: "insert.quote",
        labelKey: "folios.editor.action.quote",
        shortcut: ">",
      },
      sep,
      { id: "insert.image", labelKey: "folios.editor.action.image" },
      { id: "insert.table", labelKey: "folios.editor.action.table" },
      {
        id: "insert.codeBlock",
        labelKey: "folios.editor.action.code-block",
        shortcut: "```",
      },
      {
        id: "insert.divider",
        labelKey: "folios.editor.action.divider",
        shortcut: "---",
      },
    ],
  },
  {
    id: "view",
    labelKey: "folios.editor.menu.view",
    entries: [
      {
        id: "view.rich",
        labelKey: "folios.editor.action.rich-text",
        availableWhenLocked: true,
      },
      {
        id: "view.source",
        labelKey: "folios.editor.action.markdown-source",
        availableWhenLocked: true,
      },
      sep,
      {
        id: "view.tree",
        labelKey: "folios.editor.action.toggle-tree",
        shortcut: "⌘1",
        binding: "mod+1",
        availableWhenLocked: true,
      },
      {
        id: "view.inspector",
        labelKey: "folios.editor.action.toggle-inspector",
        shortcut: "⌘2",
        binding: "mod+2",
        availableWhenLocked: true,
      },
      sep,
      {
        id: "view.focus",
        labelKey: "folios.editor.action.focus-mode",
        shortcut: "⌘.",
        binding: "mod+.",
        availableWhenLocked: true,
      },
    ],
  },
  {
    id: "history",
    labelKey: "folios.editor.menu.history",
    entries: [
      {
        id: "history.revisions",
        labelKey: "folios.editor.action.revisions",
        shortcut: "⌘Y",
        binding: "mod+y",
      },
      { id: "history.compare", labelKey: "folios.editor.action.compare" },
      { id: "history.restore", labelKey: "folios.editor.action.restore" },
      sep,
      { id: "history.keep", labelKey: "folios.editor.action.keep-version" },
    ],
  },
];

export const folioMenuItems = (): FolioMenuItem[] =>
  FOLIO_MENUS.flatMap((menu) =>
    menu.entries.filter((e): e is FolioMenuItem => !("separator" in e)),
  );

/**
 * Binding string → action id, for the keyboard handler.
 */
export const folioShortcutBindings = (): Map<string, FolioActionId> => {
  const map = new Map<string, FolioActionId>();
  for (const item of folioMenuItems()) {
    if (item.binding) map.set(item.binding, item.id);
  }
  return map;
};

/**
 * Actions that need a folio that already exists on the server: they act on
 * a row (`id`) or on its revision history.
 */
const NEEDS_SAVED_FOLIO = new Set<FolioActionId>([
  "folio.duplicate",
  "folio.export",
  "folio.encrypt",
  "history.revisions",
  "history.compare",
  "history.restore",
  "history.keep",
]);

export interface FolioActionState {
  /**
   * The folio is protected and the passphrase has not been supplied in
   * this session, so the body is ciphertext.
   */
  locked: boolean;
  /**
   * Create mode — nothing has been persisted yet.
   */
  isNew: boolean;
  dirty: boolean;
}

export const isFolioActionEnabled = (
  id: FolioActionId,
  state: FolioActionState,
): boolean => {
  if (state.isNew && NEEDS_SAVED_FOLIO.has(id)) return false;
  if (!state.locked) return true;
  const item = folioMenuItems().find((i) => i.id === id);
  return item?.availableWhenLocked === true;
};
