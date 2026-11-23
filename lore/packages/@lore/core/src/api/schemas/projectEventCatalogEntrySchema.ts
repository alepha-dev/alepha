import { type Infer, z } from "alepha";

/**
 * One event a project can emit, as the Notifications page, `event_catalog`
 * and `lore event catalog` read it (#Q3892, #Q3895). `available` is false
 * when the project lacks the capability or option the event needs, and
 * `needs` says which.
 */
export const projectEventCatalogEntrySchema = z.object({
  name: z.string(),
  label: z.string(),
  resource: z.string(),
  fields: z.record(z.string(), z.string()),
  permission: z.string(),
  needs: z
    .object({
      capability: z.string(),
      option: z.string().optional(),
    })
    .optional(),
  filter: z
    .object({ field: z.string(), resource: z.enum(["host", "app", "monitor"]) })
    .optional(),
  available: z.boolean(),
  reason: z.string().optional(),
});

export type ProjectEventCatalogEntry = Infer<
  typeof projectEventCatalogEntrySchema
>;
