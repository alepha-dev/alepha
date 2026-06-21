import { $atom, $state, type Static, t } from "alepha";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Audit module configuration atom.
 */
export const auditOptions = $atom({
  name: "alepha.api.audits.options",
  schema: t.object({
    /**
     * Default number of days audit entries are retained before the periodic
     * cleanup job ({@link AuditJobs}) deletes them.
     *
     * Applies to every audit type that does not declare its own
     * `retentionDays`. Set to `0` to disable automatic cleanup of those types
     * entirely (keep them forever).
     */
    retentionDays: t.integer({
      description:
        "Default days to retain audit entries before cleanup. 0 disables cleanup.",
      minimum: 0,
      default: 90,
    }),
  }),
  default: {
    retentionDays: 90,
  },
});

export type AuditOptions = Static<typeof auditOptions.schema>;

declare module "alepha" {
  interface State {
    [auditOptions.key]: AuditOptions;
  }
}

// ---------------------------------------------------------------------------------------------------------------------

/**
 * Typed accessor for audit module configuration ({@link auditOptions}).
 */
export class AuditParameters {
  protected readonly options = $state(auditOptions);

  public get<K extends keyof AuditOptions>(key: K): AuditOptions[K] {
    return this.options[key];
  }
}
