import { type Infer, z } from "alepha";

/**
 * A stack environment's services as the console shows them: what the applied
 * revision declares, joined with what the machine last reported. Nothing in
 * it is secret; a value the machine never reported is absent, not zero.
 */
export const stackServicesResourceSchema = z.object({
  revision: z.integer().optional(),
  reportedAt: z.string().optional(),
  stopped: z.boolean().optional(),
  services: z.array(
    z.object({
      name: z.string(),
      kind: z.enum(["app", "service"]),
      app: z.string().optional(),
      image: z.string().optional(),
      routes: z.array(z.string()),
      digest: z.string().optional(),
      state: z.string().optional(),
      running: z.boolean().optional(),
      memoryBytes: z.integer().optional(),
      restarts: z.integer().optional(),
      startedAt: z.string().optional(),
      domains: z.array(z.string()).optional(),
    }),
  ),
  volumes: z.array(
    z.object({
      name: z.string(),
      /**
       * Whether a backup hook covers it; absent until the machine has said.
       */
      backedUp: z.boolean().optional(),
    }),
  ),
});

export type StackServicesResource = Infer<typeof stackServicesResourceSchema>;
