import { type Infer, z } from "alepha";

/**
 * What GitHub sends back to `/github/connect` after an install (#Q4362):
 * Lore's state, the user code (the App asks the installer's authorization),
 * the installation, and `install`, `update` or `request`.
 */
export const githubConnectCallbackBodySchema = z.object({
  state: z.string().min(1).max(200),
  code: z
    .string()
    .regex(/^[A-Za-z0-9_-]{1,100}$/)
    .optional(),
  installationId: z.integer().min(1).optional(),
  setupAction: z.enum(["install", "update", "request"]).optional(),
});

export type GitHubConnectCallbackBody = Infer<
  typeof githubConnectCallbackBodySchema
>;
