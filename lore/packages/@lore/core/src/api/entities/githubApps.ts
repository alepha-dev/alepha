import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { users } from "./users.ts";

/**
 * The instance's GitHub App (#Q4360, epic #E177): at most one row, whose id
 * is always `instance`.
 *
 * Written by GitHub's manifest flow from Admin > GitHub
 * (`GitHubAppService.completeManifest`). An instance that registered its
 * App by hand sets the `GITHUB_APP_*` environment instead, and the
 * environment wins over this row (`GitHubAppService.credentials`).
 *
 * ⚠️ `privateKey`, `webhookSecret` and `clientSecret` are sealed
 * (`CredentialSealService.GITHUB_APP_PURPOSE`): recoverable on a running
 * instance, unreadable in a leaked database. They are opened only to sign a
 * JWT, verify a delivery or exchange a user code, and are never returned,
 * logged or shown after creation. The private key is stored as PKCS#8, the
 * one format WebCrypto imports (`GitHubKeyFormat`), whatever GitHub handed
 * over.
 */
export const githubApps = $entity({
  name: "github_apps",
  schema: z.object({
    /**
     * Always `instance`: one App per Lore instance.
     */
    id: db.primaryKey(z.string().min(1).max(16)),
    /**
     * GitHub's numeric App id, kept as text: it is an identifier, never a
     * number Lore computes with.
     */
    appId: z.string().min(1).max(32),
    slug: z.string().min(1).max(100),
    name: z.string().min(1).max(100),
    /**
     * The App's page on GitHub, `https://github.com/apps/<slug>`.
     */
    htmlUrl: z.string().max(512),
    /**
     * The account that owns the App on GitHub, a user or an organization.
     */
    ownerLogin: z.string().max(100).optional(),
    clientId: z.string().min(1).max(64),
    clientSecret: z.string().max(4096),
    privateKey: z.string().max(16384),
    webhookSecret: z.string().max(4096),
    credentialKeyVersion: z.integer(),
    /**
     * When GitHub's `ping` last reached the webhook endpoint: GitHub sends
     * one when the App is created and on demand from its settings, so this
     * is the proof the webhook URL is reachable from GitHub.
     */
    webhookPingAt: z.string().optional(),
    createdBy: db.ref(z.uuid().optional(), () => users.cols.id, {
      onDelete: "set null",
    }),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
  }),
});

export type GitHubAppRow = Infer<typeof githubApps.schema>;
