/**
 * The Quests page has two surfaces — the grouped table and the kanban board —
 * and the choice between them lives in the URL (`?view=kanban`) so a shared
 * link opens a board and the back button behaves.
 *
 * `localStorage` only *seeds* that URL on a bare `/p/:id/` visit; an explicit
 * `?view=` always wins. Keeping the URL the single source of truth matters
 * beyond bookmarking: `ProjectView` reads the same query param to drop the
 * quest log and go full width under the board, and it cannot see this module.
 */
export type QuestsView = "list" | "kanban";

const STORAGE_KEY = "lor.quests.view";

export const readStoredQuestsView = (): QuestsView | undefined => {
  if (typeof window === "undefined") return undefined;
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw === "kanban" || raw === "list" ? raw : undefined;
};

export const writeStoredQuestsView = (view: QuestsView): void => {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, view);
};
