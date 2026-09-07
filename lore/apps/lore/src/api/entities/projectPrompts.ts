import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { agentPromptKindSchema } from "../schemas/agentPromptKindSchema.ts";
import { projects } from "./projects.ts";

/**
 * A project's customised agent prompts, one row per customised kind.
 *
 * **A row exists only for a kind somebody edited. Absence is the built-in
 * default**, which lives in `web/app/prompts/agentPromptDefaults.ts`. Reset
 * deletes the row rather than writing the default into it, so a project that
 * never edits a prompt keeps following the shipped text as it improves.
 *
 * ⚠️ **A table rather than more keys in `project_capabilities.options`.**
 * That column is `db.default(z.record(z.text(), z.boolean()), {})`, so a
 * template cannot go in it without widening the value type, which that
 * entity's own doc calls safe in one direction only. Nor on
 * `projectResourceSchema`: `userProjectsAtom` holds one copy of that per
 * project, and four templates of up to 20 000 characters each is not a thing
 * to carry in a sidebar's state. A child table is a plain additive
 * `CREATE TABLE` and touches neither.
 */
export const projectPrompts = $entity({
  name: "project_prompts",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    kind: agentPromptKindSchema,
    /**
     * The template, with `{{name}}` placeholders.
     *
     * ⚠️ **`z.string()`, never `z.text()`**: that caps at 255 characters, and
     * on a response schema a value past the cap is a blank screen rather than
     * a truncated field. The built-in defaults already run past 2 000.
     *
     * `.min(1)` is a promise rather than a validation detail: the entity
     * schema decodes on READ too, so it says no empty row is ever written.
     * The editor disables Save on empty rather than sending one to be
     * refused.
     */
    template: z.string().min(1).max(20_000),
    createdAt: db.createdAt(),
    /**
     * ⚠️ Present here and absent on `project_capabilities`, and the
     * difference is real: a template is edited, a capability row is created
     * and deleted. "When was this prompt last changed" is a question someone
     * asks; "when was this capability last changed" is answered by the row
     * existing.
     */
    updatedAt: db.updatedAt(),
  }),
  indexes: [{ columns: ["projectId", "kind"], unique: true }],
});

export type ProjectPrompt = Infer<typeof projectPrompts.schema>;
