/**
 * Reordering for the kanban column list in project settings.
 *
 * `ProjectController.reorderKanbanColumns` refuses anything that is not a
 * permutation of the current list — same members, same length, no
 * duplicates — so the client has to produce exactly that or the request is
 * rejected. Splicing an array by two names is where an off-by-one hides, so
 * it lives here rather than inline in the drop handler.
 */
export class KanbanColumnOrder {
  /**
   * Moves `active` to the position currently held by `over`, shifting the
   * rest along. Returns the input unchanged when the move is a no-op or
   * either name is absent, so a stray drop cannot fabricate a request the
   * server would refuse anyway.
   */
  move(columns: string[], active: string, over: string): string[] {
    if (active === over) return columns;

    const from = columns.indexOf(active);
    const to = columns.indexOf(over);
    if (from === -1 || to === -1) return columns;

    const next = [...columns];
    next.splice(from, 1);
    // Computed against the array with `active` already removed, which is
    // what makes a downward move land after the target rather than before.
    next.splice(next.indexOf(over) + (to > from ? 1 : 0), 0, active);
    return next;
  }
}
