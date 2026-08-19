import { z } from "alepha";

/**
 * The two fields a person fills in for an epic. Everything else about one
 * is derived or transitioned: `number` comes from `$sequence`, `status`
 * always starts `planned` (see `EpicController.createEpic`) and moves only
 * through the lifecycle verbs, and the quest/folio membership is attached
 * afterwards.
 *
 * Shared by create and update, which is what lets `EpicCreate` be one
 * component in two modes — the same form that made the epic is the one
 * that edits it, so the two can never drift.
 *
 * `title` repeats the entity's own `min(3).max(80)` rather than deriving
 * from `epics.schema`: the bounds are a UI contract here (the form shows
 * the error before a round trip) and a storage contract there, and
 * `epics.schema.pick(...)` would also drag in the `db.default("")` on
 * `description`, which would make the field non-optional in the form.
 */
export const epicCreateSchema = z.object({
  title: z.string().min(3).max(80),
  description: z.string().meta({ size: "rich" }).optional(),
});
