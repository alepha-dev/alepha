import { $atom, z } from "alepha";

/**
 * The agent prompt templates this project has customised, keyed by kind.
 *
 * Set by the `project` route loader on enter and cleared on leave, exactly
 * like {@link currentEpicsAtom} and {@link currentAreasAtom} beside it. That
 * lifecycle is also why the atom carries no `projectId`: the loader scopes
 * it, and a second copy of the answer is a second thing that can be wrong.
 *
 * ⚠️ **It exists so the copy can happen inside the click.** Safari's
 * transient activation does not survive an `await` before
 * `navigator.clipboard.writeText`, which is why the feature originally
 * needed a dialog to copy from. Reading the templates once per project
 * removes the await, and the dialog with it.
 *
 * **A kind absent here follows the built-in default** in
 * `web/app/prompts/agentPromptDefaults.ts`. The server only ever returns the
 * rows that exist, so absence is the answer rather than a gap.
 *
 * ⚠️ `{}` is ambiguous, knowingly: it is what the loader writes when the
 * `agentPrompts` option is off, and also what a project that has customised
 * nothing reads back. The two cannot be told apart, and nothing here tries.
 * The consequence is that flipping the switch on a page already loaded
 * leaves stored templates unread until the next project navigation, which is
 * why the Settings section that owns the switch refetches unconditionally
 * and writes back here.
 */
export const projectPromptsAtom = $atom({
  name: "lor.project.prompts",
  /**
   * ⚠️ A string key rather than `agentPromptKindSchema`, and not by
   * oversight. `z.record` over an enum is EXHAUSTIVE in zod v4: it would
   * demand all four keys, and the whole point of this atom is that only
   * the customised ones are in it. `z.partialRecord` is not among the
   * schemas alepha re-exports.
   *
   * Nothing is lost that matters: the only writers are the route loader,
   * which reads rows whose `kind` the server validated against the enum,
   * and the Settings section, which writes the kind it just edited. The
   * enum is enforced where a bad value could persist.
   */
  schema: z.record(z.string(), z.string()).optional(),
});
