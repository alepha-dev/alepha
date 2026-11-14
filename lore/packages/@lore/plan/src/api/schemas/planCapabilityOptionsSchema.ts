import { type Infer, z } from "alepha";

/**
 * The switches inside the Plan capability (Work until #E143).
 *
 * A quest list and its board are always there when Work is on; these
 * organize them. `epics` and `releases` are surfaces; `estimate`, `chrono`
 * and `reminder` are the three quest toggles, one methodology in three parts,
 * adopted later rather than picked at creation. `agentPrompts` is neither: it adds a menu to
 * surfaces the other options decide the existence of, and its templates are
 * edited on this same Settings page. `feedback` is the request form and the
 * triage inbox, a capability of its own (Support) until #E143 folded it in.
 * Automations are not an option: they are part of Plan wherever Plan is on
 * (#Q3594).
 *
 * ⚠️ **`releases` is what `features.milestones` became.** That key could never
 * be fixed in place: renaming a required key inside `projects.features` leaves
 * every existing row missing one, and a row missing a required key does not
 * fall back to `undefined`, it stops decoding. Moving the storage is what let
 * the name move with it.
 *
 * **Every option defaults to `false`, and that is the read rule of the whole
 * epic**: an absent key is a row written before that key existed, and the only
 * safe reading of "the project never said" is "off". Distinct from what the
 * creation wizard preselects, which is `preselected` on the registry's
 * descriptor and applies once, at creation.
 *
 * ⚠️ Lax on purpose: unknown keys are stripped, not refused, so a row written
 * by a build that has one more option than this one still loads. The write
 * path is where an unknown key must be loud - `CapabilityRegistry.strictOptionsOf`
 * is the closed variant, and it is the only place a typo can be caught.
 */
export const planCapabilityOptionsSchema = z.object({
  epics: z.boolean().default(false),
  releases: z.boolean().default(false),
  estimate: z.boolean().default(false),
  chrono: z.boolean().default(false),
  reminder: z.boolean().default(false),
  agentPrompts: z.boolean().default(false),
  feedback: z.boolean().default(false),
});

export type PlanCapabilityOptions = Infer<typeof planCapabilityOptionsSchema>;
