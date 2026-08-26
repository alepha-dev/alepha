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
  | "edit.bold"
  | "edit.italic"
  | "edit.code"
  | "insert.heading1"
  | "insert.heading2"
  | "insert.heading3"
  | "insert.bulletList"
  | "insert.numberedList"
  | "insert.quote"
  | "insert.table"
  | "insert.codeBlock"
  | "insert.diagram"
  | "insert.divider"
  | "edit.find"
  | "view.mode"
  | "view.tree"
  | "view.inspector"
  | "view.focus"
  | "history.revisions";

export interface FolioMenuItem {
  id: FolioActionId;
  labelKey: string;
  /**
   * Key chord glyph displayed right-aligned in the menu, e.g. `⌘S`.
   * Must be paired with a `binding` — never used without one.
   */
  shortcut?: string;
  /**
   * Normalized binding the keyboard handler matches against: lowercase,
   * `+`-joined, modifiers ordered `mod`, `shift`, `alt`. `mod` is ⌘ on
   * macOS and Ctrl elsewhere. Always paired with a `shortcut`.
   */
  binding?: string;
  /**
   * Markdown syntax hint displayed right-aligned in the menu, e.g. `##` or `[[`.
   * Never paired with a binding — these are what the user *types*, not key
   * chords to bind.
   */
  syntaxHint?: string;
  /**
   * Alternative label key for toggle actions that switch between two states.
   * Used by `folio.pin` (Pin / Unpin) and `folio.encrypt` (Encrypt / Remove
   * protection) when the subject is in the appropriate state (`isPinned` /
   * `isProtected`). If omitted, the single `labelKey` is always used.
   */
  alternateLabelKey?: string;
  danger?: boolean;
  /**
   * Stays usable while the folio is protected and still locked. Only
   * navigation, pane toggles and destructive folio-level actions qualify —
   * nothing that would write to a body the user cannot read.
   */
  availableWhenLocked?: boolean;
  /**
   * Stays usable at `/folios` with no folio open at all. Only creating
   * something and moving the panes around qualify — there is no document,
   * so there is nothing to save, format, export or version.
   *
   * The menubar still renders every other item, disabled: the menus must
   * keep their shape between the empty and open states, or the surface
   * appears to change identity when you open a folio.
   */
  availableWithoutFolio?: boolean;
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
        availableWhenLocked: true,
        availableWithoutFolio: true,
      },
      {
        id: "folio.newDirectory",
        labelKey: "folios.editor.action.new-directory",
        availableWhenLocked: true,
        availableWithoutFolio: true,
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
        alternateLabelKey: "folios.editor.action.unpin",
        availableWhenLocked: true,
      },
      sep,
      { id: "folio.export", labelKey: "folios.editor.action.export" },
      {
        id: "folio.encrypt",
        labelKey: "folios.editor.action.encrypt",
        alternateLabelKey: "folios.editor.action.remove-protection",
      },
      sep,
      {
        id: "folio.delete",
        labelKey: "folios.editor.action.delete",
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
        id: "edit.bold",
        labelKey: "folios.editor.action.bold",
        shortcut: "\u2318B",
        binding: "mod+b",
      },
      {
        id: "edit.italic",
        labelKey: "folios.editor.action.italic",
        shortcut: "\u2318I",
        binding: "mod+i",
      },
      {
        id: "edit.code",
        labelKey: "folios.editor.action.code",
        syntaxHint: "`",
      },
      sep,
      {
        id: "edit.find",
        labelKey: "folios.editor.action.find",
        shortcut: "\u2318F",
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
        id: "insert.heading1",
        labelKey: "folios.editor.action.heading1",
        syntaxHint: "#",
      },
      {
        id: "insert.heading2",
        labelKey: "folios.editor.action.heading2",
        syntaxHint: "##",
      },
      {
        id: "insert.heading3",
        labelKey: "folios.editor.action.heading3",
        syntaxHint: "###",
      },
      sep,
      {
        id: "insert.bulletList",
        labelKey: "folios.editor.action.bullet-list",
        syntaxHint: "-",
      },
      {
        id: "insert.numberedList",
        labelKey: "folios.editor.action.numbered-list",
        syntaxHint: "1.",
      },
      {
        id: "insert.quote",
        labelKey: "folios.editor.action.quote",
        syntaxHint: ">",
      },
      sep,
      { id: "insert.table", labelKey: "folios.editor.action.table" },
      {
        id: "insert.codeBlock",
        labelKey: "folios.editor.action.code-block",
        syntaxHint: "```",
      },
      {
        id: "insert.diagram",
        labelKey: "folios.editor.action.diagram",
        syntaxHint: "mermaid",
      },
      {
        id: "insert.divider",
        labelKey: "folios.editor.action.divider",
        syntaxHint: "---",
      },
    ],
  },
  {
    id: "view",
    labelKey: "folios.editor.menu.view",
    entries: [
      {
        id: "view.mode",
        labelKey: "folios.editor.action.toggle-mode",
        shortcut: "\u2318E",
        binding: "mod+e",
      },
      sep,
      {
        id: "view.tree",
        labelKey: "folios.editor.action.toggle-tree",
        shortcut: "⌘\\",
        binding: "mod+\\",
        availableWhenLocked: true,
        availableWithoutFolio: true,
      },
      {
        id: "view.inspector",
        labelKey: "folios.editor.action.toggle-inspector",
        shortcut: "⇧⌘\\",
        binding: "mod+shift+\\",
        availableWhenLocked: true,
        availableWithoutFolio: true,
      },
      sep,
      {
        id: "view.focus",
        labelKey: "folios.editor.action.focus-mode",
        shortcut: "⌘.",
        binding: "mod+.",
        availableWhenLocked: true,
        availableWithoutFolio: true,
      },
    ],
  },
  {
    id: "history",
    labelKey: "folios.editor.menu.history",
    entries: [
      // Compare / Restore / Keep this version used to sit here, enabled and
      // bound to a no-op. Each acts on a SPECIFIC revision, which is a
      // concept that only exists inside the History tab's own per-row UI —
      // there is no "the current one" a top-level menu entry could mean. An
      // entry that opens and does nothing is worse than one that is not
      // there, so they are gone until that UI is designed.
      {
        id: "history.revisions",
        labelKey: "folios.editor.action.revisions",
        shortcut: "⌘Y",
        binding: "mod+y",
      },
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
  "folio.delete",
  "folio.move",
  "folio.pin",
  "folio.duplicate",
  "folio.export",
  "folio.encrypt",
  "history.revisions",
]);

/**
 * Actions that edit the document text, so they need CodeMirror mounted —
 * i.e. Edit mode. In View mode there is nothing to apply them to.
 */
const NEEDS_EDIT_MODE = new Set<FolioActionId>([
  "edit.bold",
  "edit.italic",
  "edit.code",
  "insert.heading1",
  "insert.heading2",
  "insert.heading3",
  "insert.bulletList",
  "insert.numberedList",
  "insert.quote",
  "insert.table",
  "insert.codeBlock",
  "insert.diagram",
  "insert.divider",
]);

export interface FolioActionState {
  /**
   * `/folios` with nothing open — no document at all, as opposed to
   * `isNew`, which is an empty but real document you can type into. The
   * strongest of the three degraded states: it wins over `isNew` and
   * `locked`, because neither can be true without a document.
   */
  noFolio?: boolean;
  /**
   * The folio is protected and the passphrase has not been supplied in
   * this session, so the body is ciphertext. Separate from `isProtected`:
   * a folio can be unlocked (`locked: false`) but still protected
   * (`isProtected: true`).
   */
  locked: boolean;
  /**
   * Create mode — nothing has been persisted yet.
   */
  isNew: boolean;
  dirty: boolean;
  /**
   * The folio has end-to-end encryption enabled. Used to determine whether
   * to show Encrypt (false) or Remove Protection (true) for `folio.encrypt`.
   */
  isProtected: boolean;
  /**
   * The folio is pinned to its project's context. Used to determine whether
   * to show Pin (false) or Unpin (true) for `folio.pin`.
   */
  isPinned: boolean;
  /**
   * The document is showing its raw face, so the formatting actions have an
   * editor to act on. False in View mode, where they are inert.
   */
  editing?: boolean;
}

export const isFolioActionEnabled = (
  id: FolioActionId,
  state: FolioActionState,
): boolean => {
  const item = folioMenuItems().find((i) => i.id === id);
  // Checked first: with no document open there is no draft to be new or
  // locked, so the other two branches have nothing to reason about.
  if (state.noFolio) return item?.availableWithoutFolio === true;
  if (!state.editing && NEEDS_EDIT_MODE.has(id)) return false;
  if (state.isNew && NEEDS_SAVED_FOLIO.has(id)) return false;
  if (!state.locked) return true;
  return item?.availableWhenLocked === true;
};
