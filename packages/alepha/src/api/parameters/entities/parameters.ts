import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

/**
 * Configuration parameter entity for versioned configuration management.
 *
 * Stores all versions of configuration parameters with:
 * - Status derived from activationDate at query time
 * - Schema versioning for migrations
 * - Activation scheduling
 * - Audit trail (creator info)
 */
export const parameters = $entity({
  name: "parameters",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),

    /**
     * Tenant scope. NULLABLE on purpose (backward compatible): single-tenant
     * apps keep writing org-less (NULL) rows with the historic global
     * semantics. In a MULTI-TENANT process (e.g. one pooled worker serving
     * many orgs), the active tenant is stamped by the Repository
     * (`stampOrganization`) and reads/writes auto-filter by it — so one org's
     * `app.settings`/`portal.site`/… can never be read or overwritten by
     * another. The provider's in-memory value caches are keyed by org too.
     */
    organizationId: db.organization(),

    /**
     * Configuration name using dot notation for tree hierarchy.
     * Examples: "app.features", "app.pricing.tiers", "system.limits"
     */
    name: z.text(),

    /**
     * The configuration content as JSON.
     */
    content: z.json(),

    /**
     * Schema version hash for detecting schema changes.
     * Used for auto-migration when schema evolves.
     */
    schemaHash: z.text(),

    /**
     * When this version should become active.
     * Default is immediate (now).
     */
    activationDate: z.datetime(),

    /**
     * Version number for this configuration.
     * Auto-incremented per config name.
     */
    version: z.integer(),

    /**
     * Optional description of changes in this version.
     */
    changeDescription: z.text().optional(),

    /**
     * Optional tags for filtering/categorization.
     */
    tags: z.array(z.text()).optional(),

    /**
     * Creator user ID (if available).
     */
    creatorId: z.uuid().optional(),

    /**
     * Creator display name for audit trail.
     */
    creatorName: z.text().optional(),

    /**
     * Previous content before this change (for rollback reference).
     */
    previousContent: z.json().optional(),

    /**
     * Migration log if schema changed.
     */
    migrationLog: z.text().optional(),
  }),
  indexes: [
    { columns: ["organizationId", "name", "activationDate"] },
    // Version numbering is per-(org, name): two tenants each own an
    // independent v1/v2/… of the same parameter name.
    { columns: ["organizationId", "name", "version"], unique: true },
    { columns: ["activationDate"] },
  ],
});

export type Parameter = Infer<typeof parameters.schema>;
