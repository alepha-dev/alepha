import { type Infer, z } from "alepha";

/**
 * What Admin > GitHub and `lore github status` show of the instance's GitHub
 * App (#Q4360): identity and links, never a secret.
 *
 * `source` says where the App's credentials come from: the
 * `GITHUB_APP_*` environment, which wins, or the row the manifest flow
 * stored. `missing` names the environment variables an instance set only
 * some of, which leaves the App unconfigured rather than half working.
 */
export const githubAppStatusSchema = z.object({
  configured: z.boolean(),
  source: z.enum(["environment", "stored"]).optional(),
  appId: z.string().optional(),
  slug: z.string().optional(),
  name: z.string().optional(),
  ownerLogin: z.string().optional(),
  htmlUrl: z.string().optional(),
  /**
   * `https://github.com/apps/<slug>/installations/new`.
   */
  installUrl: z.string().optional(),
  /**
   * Where GitHub posts deliveries: `<PUBLIC_URL>/api/github/webhook`.
   * Absent while `PUBLIC_URL` is not set, which also refuses the manifest.
   */
  webhookUrl: z.string().optional(),
  /**
   * When GitHub's `ping` last reached that URL. Absent: GitHub has not
   * reached it since the App was stored.
   */
  webhookPingAt: z.string().optional(),
  missing: z.array(z.string()).optional(),
  createdAt: z.string().optional(),
});

export type GitHubAppStatus = Infer<typeof githubAppStatusSchema>;
