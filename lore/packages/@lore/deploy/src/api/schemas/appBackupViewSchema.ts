import { type Infer, z } from "alepha";

import { estateEvents } from "../entities/estateEvents.ts";
import { estateInventoryAppSchema } from "./estateInventoryAppSchema.ts";

/**
 * Why a copy has no backup to show, or `reported` when it has one.
 *
 * Each is a different sentence on the page and a different fix: choose an
 * estate, deploy, wait for the machine to report.
 */
export const APP_BACKUP_STATUSES = [
  "no-estate",
  "not-bay",
  "not-lent",
  "not-deployed",
  "not-reported",
  "reported",
] as const;

export const appBackupViewSchema = z.object({
  status: z.enum(APP_BACKUP_STATUSES),
  estate: z
    .object({
      id: z.uuid(),
      slug: z.string(),
      label: z.string().optional(),
      online: z.boolean(),
      deployAllowed: z.boolean(),
    })
    .optional(),
  /** The instance's name on the machine, project segment included. */
  machineApp: z.string().optional(),
  reportedAt: z.string().optional(),
  instance: estateInventoryAppSchema.optional(),
  events: z.array(estateEvents.schema),
});

export type AppBackupView = Infer<typeof appBackupViewSchema>;
