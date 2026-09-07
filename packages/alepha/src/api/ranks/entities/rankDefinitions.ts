import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * One rank, as an application has customised it inside one scope.
 *
 * ## ⚠️ This table holds definitions, never assignments
 *
 * There is no `(userId, scopeId, rank)` row anywhere in this module, and
 * adding one is the single change that would ruin it. Every authenticated
 * request would then pay a read forever, in every consuming application. The
 * assignment is a **column on a row the application already reads** - the
 * membership row a resource gate loaded, or the user row a session was built
 * from - and `$rankResource` says which column that is.
 *
 * What lives here is the far smaller thing: what a rank MEANS. That changes
 * when somebody edits it, is shared by every holder, and is cached, which is
 * exactly what an assignment must never be.
 *
 * ## Only what was customised
 *
 * A scope that has never touched its ranks stores **zero rows**: the built-in
 * ranks live in code, on the `$rankResource` declaration. A row appears when
 * an application seeds a preset or a person creates a rank of their own.
 *
 * ## `scopeId` is text, and it is required
 *
 * Text, like `invitations.resourceId`, because this module must never parse
 * an id whose shape it cannot know: an application stringifies its integer,
 * or passes its own constant.
 *
 * Required, and never nullable, which is the part worth stating. A
 * single-tenant application's scope is one value and the temptation is to
 * model it as NULL. **SQLite treats NULLs as distinct in a UNIQUE index** -
 * this repository already records that on `projects.slug` - so
 * `UNIQUE(scopeId, key)` with a NULL scope silently permits duplicate keys,
 * and which duplicate wins is not deterministic. A single-tenant application
 * declares a constant instead, the module never branches, and there is no
 * degenerate path to test.
 */
export const rankDefinitions = $entity({
  name: "rank_definitions",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    version: db.version(),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),

    /**
     * Tenant scope, nullable, following `invitations` exactly.
     *
     * Deliberately NOT part of the unique index below: a NULL is distinct in
     * a unique index on SQLite, so including it would give a single-tenant
     * application no uniqueness at all. A pooled multi-tenant application
     * makes its scope ids globally unique itself.
     */
    organizationId: db.organization(),

    /**
     * Which `$rankResource` this row belongs to, e.g. `"project"`.
     */
    type: z.text({ minLength: 1, maxLength: 100 }),

    /**
     * Which scope, as a string. See the note above on why this is text and
     * why it is never null.
     */
    scopeId: z.text({ minLength: 1, maxLength: 255 }),

    /**
     * The stable id an assignment stores.
     *
     * ⚠️ **Opaque, and never derived from `name`.** Renaming a rank must not
     * touch the assignment column of every member holding it, and a key
     * computed from a display name does exactly that - silently, on a write
     * that looks like a relabelling.
     */
    key: z.text({ minLength: 1, maxLength: 64 }),

    /**
     * What a person reads. Free to change, because nothing stores it.
     */
    name: z.text({ minLength: 1, maxLength: 100 }),

    /**
     * Non-removable and non-rekeyable.
     *
     * For a rank an application seeds and then wants permanent. It is not how
     * the declared built-ins work - those live in code and have no row at all
     * - but a stored rank has no other way to say the same thing.
     */
    builtin: db.default(z.boolean(), false),

    /**
     * The permissions this rank grants inside its scope, as `group:name`.
     *
     * Validated on write against the application's own permission registry:
     * a rank can only name a permission something declared, which is what
     * makes "never widen" checkable rather than aspirational.
     */
    permissions: z.array(z.text()),
  }),
  indexes: [
    {
      columns: ["type", "scopeId", "key"],
      unique: true,
    },
    { columns: ["type", "scopeId"] },
  ],
});

export type RankDefinitionEntity = Infer<typeof rankDefinitions.schema>;
