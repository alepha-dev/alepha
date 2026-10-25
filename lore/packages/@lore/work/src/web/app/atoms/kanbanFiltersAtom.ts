import { $atom, z } from "alepha";

/**
 * The board's filter bar, remembered across navigation.
 *
 * The bar used to be a `useForm` with `handler: async () => {}` and no
 * persistence at all, so every selection reset the moment you opened a card
 * and came back — on the surface whose whole job is narrowing a backlog.
 *
 * ⚠️ Deliberately NOT in the URL. The quests table's `?status=` seeding is
 * safe because it is read once on entry and never written back; a filter
 * bar writes on every keystroke, which is the write-back half of #156 that
 * made every sidebar link dead. An atom answers "remember my filter"
 * without putting the board one bad effect away from that.
 *
 * `projectId` is stored alongside so filters do not leak between projects:
 * a different project reads as no filter rather than as somebody else's
 * area names, which would render an empty board with no visible cause.
 * One project's worth of memory is all "survives navigation" needs.
 *
 * `persist: "cookie"` rather than `localStorage`, matching
 * `questLogCollapsedAtom`: the board renders during SSR, where web storage
 * does not exist.
 */
export const kanbanFiltersAtom = $atom({
  name: "lor.kanban.filters",
  schema: z.object({
    projectId: z.integer().optional(),
    areas: z.array(z.string()),
    tags: z.array(z.string()),
    /**
     * Free text, matched against the title and the `#shortId`.
     */
    search: z.string(),
    /**
     * A member's user id, or `"me"` for the viewer — stored as the sentinel
     * rather than resolved, so the memory survives being read by a
     * different account.
     */
    assignee: z.string().optional(),
    /**
     * `overdue` and `week` read `dueAt`; absent means no due filter.
     */
    due: z.enum(["overdue", "week"]).optional(),
  }),
  default: {
    areas: [] as string[],
    tags: [] as string[],
    search: "",
  },
  persist: "cookie",
});
