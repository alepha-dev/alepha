import { $atom, z } from "alepha";

/**
 * The viewer's dock (#E139): the ids of the projects they pinned to the
 * project rail, in order. Filled with `userProjectsAtom`, from the same
 * `getHomeOverview` call, and replaced by the answer of every dock action.
 *
 * `undefined` until it is loaded.
 *
 * ⚠️ **Personal.** It is one person's preference, so it travels in the
 * private script built for each request and never in the shared SSR payload:
 * a cached page cannot hand one viewer's dock to the next.
 */
export const userDockAtom = $atom({
  name: "lor.user.dock",
  schema: z.array(z.integer()).optional(),
  personal: true,
});
