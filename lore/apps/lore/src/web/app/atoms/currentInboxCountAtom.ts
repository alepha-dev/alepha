import { $atom, z } from "alepha";

/**
 * Unread messages **in the current project**.
 *
 * ⚠️ **Not the same number as the bell's.** `inboxUnreadAtom` in
 * `@alepha/ui` counts every project you belong to, because the bell is
 * cross-project by design; this one is filtered to `project:<id>` for the
 * sidebar entry. A reader seeing 3 on the bell and 1 in the rail is looking
 * at two honest answers to two different questions, and the only defence
 * against them being confused is that neither name could be read as the
 * other.
 *
 * Written by the `project` route loader and cleared on project leave, like
 * the four badge counts beside it. Errors count as 0, so the badge hides.
 *
 * Wrapped in an object because `$atom` schemas must be object or array.
 */
export const currentInboxCountAtom = $atom({
  name: "lor.current.inbox_count",
  schema: z.object({
    count: z.integer(),
  }),
  default: { count: 0 },
});
