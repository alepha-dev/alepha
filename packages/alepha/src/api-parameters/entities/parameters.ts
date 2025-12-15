import { type Static, t } from "alepha";
import { $entity, pg } from "alepha/orm";

/**
 * Parameter status values.
 *
 * - EXPIRED: Past version, no longer active
 * - CURRENT: Currently active version
 * - NEXT: Scheduled to become active (closest future date)
 * - FUTURE: Scheduled for activation after NEXT
 */
export type ParameterStatus = "expired" | "current" | "next" | "future";

/**
 * Configuration parameter entity for versioned configuration management.
 *
 * Stores all versions of configuration parameters with:
 * - Automatic status management (expired, current, next, future)
 * - Schema versioning for migrations
 * - Activation scheduling
 * - Audit trail (creator info)
 */
export const parameters = $entity({
  name: "parameters",
  schema: t.object({
    id: pg.primaryKey(t.uuid()),
    createdAt: pg.createdAt(),
    updatedAt: pg.updatedAt(),

    /**
     * Configuration name using dot notation for tree hierarchy.
     * Examples: "app.features", "app.pricing.tiers", "system.limits"
     */
    name: t.text(),

    /**
     * The configuration content as JSON.
     */
    content: t.json(),

    /**
     * Schema version hash for detecting schema changes.
     * Used for auto-migration when schema evolves.
     */
    schemaHash: t.text(),

    /**
     * Current status of this parameter version.
     */
    status: pg.default(
      t.enum(["expired", "current", "next", "future"]),
      "future",
    ),

    /**
     * When this version should become active.
     * Default is immediate (now).
     */
    activationDate: t.datetime(),

    /**
     * When this version was deactivated (became expired).
     * Null if still active or scheduled.
     */
    expiredAt: t.optional(t.datetime()),

    /**
     * Version number for this configuration.
     * Auto-incremented per config name.
     */
    version: t.integer(),

    /**
     * Optional description of changes in this version.
     */
    changeDescription: t.optional(t.text()),

    /**
     * Optional tags for filtering/categorization.
     */
    tags: t.optional(t.array(t.text())),

    /**
     * Creator user ID (if available).
     */
    creatorId: t.optional(t.uuid()),

    /**
     * Creator display name for audit trail.
     */
    creatorName: t.optional(t.text()),

    /**
     * Previous content before this change (for rollback reference).
     */
    previousContent: t.optional(t.json()),

    /**
     * Migration log if schema changed.
     */
    migrationLog: t.optional(t.text()),
  }),
  indexes: [
    { columns: ["name", "status"] },
    { columns: ["name", "activationDate"] },
    { columns: ["name", "version"], unique: true },
    { columns: ["status"] },
    { columns: ["activationDate"] },
  ],
});

export type Parameter = Static<typeof parameters.schema>;
export type ParameterInsert = Omit<Parameter, "id" | "createdAt" | "updatedAt">;
