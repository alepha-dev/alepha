import { projects } from "@lore/core/schemas";
import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { personaKindSchema } from "../schemas/personaKindSchema.ts";

/**
 * A persona (`#A<n>`, #E153): an actor of the system the project builds,
 * with its goals, the Alepha role it plays, a demo account and the app copy
 * it lives on.
 *
 * The environment is the copy's `app` and `env` NAMES, the pair
 * `app_instances` is keyed by, never a foreign key: a copy can be deleted,
 * and Requirements runs without Ship.
 */
export const personas = $entity({
  name: "personas",
  schema: z.object({
    id: db.primaryKey(z.integer()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    deletedAt: db.deletedAt(),
    projectId: db.ref(z.integer(), () => projects.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * Per-project number, `#A<n>`, from `$sequence` under the property name
     * `personaNumber` on `PersonaController`: renaming that property restarts
     * every project's counter.
     */
    number: z.integer().min(1),
    kind: db.default(personaKindSchema.meta({ mode: "text" }), "human"),
    name: z.string().min(1).max(80),
    /**
     * One line: "Shop manager".
     */
    role: z.string().max(120).optional(),
    who: db.default(z.string().meta({ size: "rich" }), ""),
    goals: db.default(z.string().meta({ size: "rich" }), ""),
    frustrations: db.default(z.string().meta({ size: "rich" }), ""),
    /**
     * The `$role` or service account this persona plays in the app. Free
     * text: the sigil reports no role, so nothing is matched against it.
     */
    alephaRole: z.string().max(120).optional(),
    /**
     * An e-mail or a login, never a password: Lore handles no credential.
     */
    demoAccount: z.string().max(200).optional(),
    /**
     * A path in the app's repository: the seed that creates the account.
     */
    demoSeed: z.string().max(300).optional(),
    environmentApp: z.string().max(120).optional(),
    environmentEnv: z.string().max(120).optional(),
    areas: db.default(z.array(z.string()), []),
  }),
  indexes: [{ columns: ["projectId", "number"], unique: true }],
});

export type Persona = Infer<typeof personas.schema>;
