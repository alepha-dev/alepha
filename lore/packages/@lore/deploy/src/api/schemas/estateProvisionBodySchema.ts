import { type Infer, z } from "alepha";

/**
 * What `lore estate provision` records on the estate once the provider has
 * created its server (#Q3166): enough to name the server later, to
 * terminate it from the CLI, and to show what it costs.
 */
export const estateProvisionBodySchema = z.object({
  provider: z.string().min(1).max(32),
  serverId: z.string().min(1).max(128),
  type: z.string().min(1).max(64),
  zone: z.string().min(1).max(64),
  hourlyPrice: z.number().min(0).optional(),
});

export type EstateProvisionBody = Infer<typeof estateProvisionBodySchema>;
