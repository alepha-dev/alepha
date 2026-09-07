import { type Infer, z } from "alepha";
import { $entity, db } from "alepha/orm";

import { appInstances } from "./appInstances.ts";

/**
 * One environment variable one deployed copy runs with.
 *
 * ## ⚠️ Per INSTANCE, not per environment
 *
 * This quest was drafted against a project-grain `environments (projectId,
 * name)` table, which was rejected (folio #1185, "Rejected 2"). The deploy
 * target is `app_instances (projectId, app, env)`, so a secret set belongs to
 * one app in one environment: `docs` has no business carrying `club`'s Stripe
 * key, and the blast radius of a leaked set is one app rather than every app
 * in the environment.
 *
 * **There are deliberately no shared secrets.** If two apps in one environment
 * later need the same value, the answer is a project-level default layer that
 * an app-level value overrides, added when it actually hurts. It is not a
 * second identity table.
 *
 * ⚠️ `instanceId` cascades, and that is the one cascade here that is plainly
 * right: a deleted copy has no environment left to configure, and secrets kept
 * past their target are secrets nobody can find to revoke. It also makes
 * `app_instances` a cascade parent a second time over - see "Migration safety
 * on D1" in `apps/lore/CLAUDE.md` before any later migration touches it.
 *
 * ## ⚠️ The value is sealed, from the first commit
 *
 * Epic #22 accepted deferring encryption of the stored Cloudflare credential
 * on the reasoning that Lore was a single-admin instance. Both halves of that
 * are gone: this table holds every downstream app's production secrets, and
 * estates went user-scope on 2026-09-04. So {@link valueSealed} is a
 * `CredentialSealService` ciphertext under `APP_SECRETS_PURPOSE`, never a
 * plaintext column, and there is no second sealer.
 *
 * ## {@link valuePrefix} is what a read path answers instead of the value
 *
 * Stored rather than derived, because deriving it would mean opening the seal
 * on every list - turning the read path that must never see a plaintext into
 * the one that decrypts every row in the table.
 *
 * ⚠️ It is empty for a short value. Four characters of a 6-character secret is
 * not a hint, it is most of the secret.
 */
export const appSecrets = $entity({
  name: "app_secrets",
  schema: z.object({
    id: db.primaryKey(z.uuid()),
    createdAt: db.createdAt(),
    updatedAt: db.updatedAt(),
    instanceId: db.ref(z.uuid(), () => appInstances.cols.id, {
      onDelete: "cascade",
    }),
    /**
     * The variable's name, as the app reads it.
     */
    key: z.string().min(1).max(100),
    /**
     * `iv:tag:ciphertext` in hex, from `CredentialSealService.seal`.
     */
    valueSealed: z.string().min(1).max(20_000),
    /**
     * The first few characters, so a list can say which value is which
     * without saying what it is. Empty for anything shorter than
     * `AppSecretService.MIN_MASKABLE_LENGTH`.
     */
    valuePrefix: db.default(z.string().max(8), ""),
    /**
     * Which key derivation sealed it, so rotating `APP_SECRET` is a re-seal
     * script rather than a crisis. Matches `CredentialSealService.KEY_VERSION`.
     */
    keyVersion: db.default(z.integer(), 1),
    /**
     * Who set it last. `undefined` for a row written by something other than a
     * person.
     */
    updatedBy: z.uuid().optional(),
  }),
  indexes: [
    // One value per name per copy: setting an existing key replaces it.
    { columns: ["instanceId", "key"], unique: true },
  ],
});

export type AppSecret = Infer<typeof appSecrets.schema>;
