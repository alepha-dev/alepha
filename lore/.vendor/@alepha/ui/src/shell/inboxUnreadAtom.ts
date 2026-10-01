import { $atom, z } from "alepha";

/**
 * How many messages the signed-in viewer has not read, **across every
 * scope**.
 *
 * ⚠️ **This is not the same number as a scope-filtered badge.** An app that
 * also shows "unread in this project" holds that in an atom of its own, and
 * the two legitimately disagree: a reader seeing 3 on the bell and 1 in a
 * project rail is looking at two honest answers to two different questions.
 * Names that cannot be confused are the whole defence, which is why this one
 * says nothing about a current anything.
 *
 * Written by whatever runs first: a route loader that folds the count into a
 * batch it was already sending, or the bell's own fetch on mount. Refreshed
 * on window focus, because a message arriving while somebody sits on a page
 * is otherwise invisible until they navigate.
 *
 * Wrapped in an object because `$atom` schemas must be object or array.
 */
export const inboxUnreadAtom = $atom({
  name: "ui.inbox.unread",
  schema: z.object({
    count: z.integer(),
  }),
  default: { count: 0 },
});
