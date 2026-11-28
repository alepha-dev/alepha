import { type Infer, z } from "alepha";

/**
 * A secret of the stored App replaced (#Q4360): a new private key generated
 * in the App's settings on GitHub, a new webhook secret, or a new client
 * secret. Each is sealed as it arrives and never read back.
 */
export const githubAppRotateBodySchema = z.object({
  privateKey: z.string().min(1).max(16384).optional(),
  webhookSecret: z.string().min(1).max(4096).optional(),
  clientSecret: z.string().min(1).max(4096).optional(),
});

export type GitHubAppRotateBody = Infer<typeof githubAppRotateBodySchema>;
