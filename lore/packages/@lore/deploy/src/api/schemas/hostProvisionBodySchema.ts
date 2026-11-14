import { type Infer, z } from "alepha";

/**
 * What `lore host provision` records on the host once the provider has
 * created its server (#Q3166): enough to name the server later, to
 * terminate it from the CLI, and to show what it costs.
 */
export const hostProvisionBodySchema = z.object({
  provider: z.string().min(1).max(32),
  serverId: z.string().min(1).max(128),
  type: z.string().min(1).max(64),
  zone: z.string().min(1).max(64),
  hourlyPrice: z.number().min(0).optional(),
});

export type HostProvisionBody = Infer<typeof hostProvisionBodySchema>;
