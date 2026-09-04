import { $atom, z } from "alepha";

import { epicRefResourceSchema } from "@/api/schemas/epicRefResourceSchema.ts";

/**
 * Every epic of the current project, as a ref: id, number, title, status.
 *
 * Set by the `project` route loader on enter and cleared on leave, exactly
 * like {@link currentReleasesAtom} — which is deliberate, because they are
 * read the same way. A quest row carries `epicId` and `releaseId`, both
 * database ids, and both columns turn them into something a reader
 * recognises by looking the id up in a list the project route already holds.
 * Two columns of the same shape resolving two different ways is how they
 * drift.
 *
 * ⚠️ Refs, NOT `EpicResource`. The full resource carries `description`
 * (`size: "rich"`), which on this project's own database is 213 KB of the
 * 222 KB `getEpics` returns. Every project navigation would pay it to render
 * a column that starts hidden. `getEpicRefs` is the projection that exists
 * for this.
 *
 * `undefined` (not read) and `[]` (no epics) are different states, the same
 * distinction `currentSigilsAtom` draws: the Epic column shows a dash for a
 * quest with no epic either way, but the sidebar badge must not report 0
 * planned epics because a request failed.
 *
 * Also the source of the sidebar's planned-epic badge, counted locally the
 * way `ProjectEpics` counts it. It replaced a `countPlannedEpics` call, so
 * this is one request rather than two.
 */
export const currentEpicsAtom = $atom({
  name: "lor.current.epics",
  schema: z.array(epicRefResourceSchema).optional(),
});
