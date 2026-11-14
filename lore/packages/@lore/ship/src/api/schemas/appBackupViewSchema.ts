import { type Infer, z } from "alepha";

import { hostEvents } from "../entities/hostEvents.ts";
import { hostInventoryAppSchema } from "./hostInventoryAppSchema.ts";

/**
 * Why a copy has no backup to show, or `reported` when it has one.
 *
 * Each is a different sentence on the page and a different fix: choose an
 * host, deploy, wait for the machine to report.
 */
export const APP_BACKUP_STATUSES = [
  "no-host",
  "not-bay",
  "not-lent",
  "not-deployed",
  "not-reported",
  "reported",
] as const;

export const appBackupViewSchema = z.object({
  status: z.enum(APP_BACKUP_STATUSES),
  host: z
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
  instance: hostInventoryAppSchema.optional(),
  events: z.array(hostEvents.schema),
});

export type AppBackupView = Infer<typeof appBackupViewSchema>;
