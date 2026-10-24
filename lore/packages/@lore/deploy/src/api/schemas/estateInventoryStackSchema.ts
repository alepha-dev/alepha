import { type Infer, z } from "alepha";

/**
 * One stack environment as a machine reports it in its inventory (Bay's
 * `InventoryStack`, pinned by `wire-v2/inventory-stacks.json`). Bounded: a
 * machine is not trusted with a size.
 */
export const estateInventoryStackSchema = z.object({
  stack: z.string().min(1).max(100),
  env: z.string().min(1).max(100),
  revision: z.integer().min(0),
  stopped: z.boolean().optional(),
  baseDomain: z.string().max(253).optional(),
  tcp: z.array(z.integer().min(1).max(65535)).max(50).optional(),
  /**
   * The environment's volumes no backup hook covers, by compose name.
   */
  notBackedUp: z.array(z.string().max(200)).max(100).optional(),
});

export type EstateInventoryStack = Infer<typeof estateInventoryStackSchema>;
