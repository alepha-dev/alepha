import { $module } from "alepha";
import { AlephaApiAudits } from "alepha/api/audits";
import { AlephaApiJobs } from "alepha/api/jobs";
import { AlephaBackground } from "alepha/background";

import { ApiKeyAudits } from "./audits/ApiKeyAudits.ts";
import { AdminApiKeyController } from "./controllers/AdminApiKeyController.ts";
import { ApiKeyController } from "./controllers/ApiKeyController.ts";
import { ApiKeyJobs } from "./jobs/ApiKeyJobs.ts";
import { ApiKeyNotifications } from "./notifications/ApiKeyNotifications.ts";
import { ApiKeyParameters } from "./parameters/ApiKeyParameters.ts";
import { ApiKeyIpAllowlist } from "./services/ApiKeyIpAllowlist.ts";
import { ApiKeyService } from "./services/ApiKeyService.ts";

export * from "./audits/ApiKeyAudits.ts";
export * from "./controllers/AdminApiKeyController.ts";
export * from "./controllers/ApiKeyController.ts";
export * from "./entities/apiKeyEntity.ts";
export * from "./jobs/ApiKeyJobs.ts";
export * from "./notifications/ApiKeyNotifications.ts";
export * from "./parameters/ApiKeyParameters.ts";
export * from "./schemas/adminApiKeyOwnerSchema.ts";
export * from "./schemas/adminApiKeyQuerySchema.ts";
export * from "./schemas/adminApiKeyResourceSchema.ts";
export * from "./schemas/apiKeyExpiresInSchema.ts";
export * from "./schemas/apiKeyOptionsResponseSchema.ts";
export * from "./schemas/apiKeyStatusSchema.ts";
export * from "./schemas/createApiKeyBodySchema.ts";
export * from "./schemas/createApiKeyResponseSchema.ts";
export * from "./schemas/listApiKeyItemSchema.ts";
export * from "./schemas/listApiKeyResponseSchema.ts";
export * from "./schemas/revokeApiKeyParamsSchema.ts";
export * from "./schemas/revokeApiKeyResponseSchema.ts";
export * from "./schemas/rotateApiKeyBodySchema.ts";
export * from "./schemas/rotateApiKeyParamsSchema.ts";
export * from "./services/ApiKeyIpAllowlist.ts";
export * from "./services/ApiKeyService.ts";

/**
 * API key management module for programmatic access.
 *
 * **Features:**
 * - Create API keys with role snapshots, capped at every request by the roles
 *   the owner holds now
 * - Expiry presets (`7d` to `1y`, or `never`) under a server-side policy
 *   (`apiKeyOptions`: default, cap, warning window), exposed to clients by
 *   `GET /api-keys/options`
 * - A derived status (`active`, `expiring`, `expired`, `revoked`) on every
 *   read, and the same rule as a query for filtering
 * - Rotation: a new secret on the same key, the old token dead at once
 * - Revocation that frees the key's name; a list that keeps dead keys until
 *   the daily purge job deletes them past their retention window
 * - A one-time expiry notice to the owner (with a realm's notifications)
 * - A permission scope per key, within what its creator may grant
 * - A per-key IP allowlist, set at creation (only as trustworthy as
 *   `TRUST_PROXY`)
 * - Throttled, approximate usage tracking (`lastUsedAt`, `usageCount`)
 * - An `api-key` audit trail: create, rotate, revoke, purge
 * - A key is a machine credential, not a session: routes declared
 *   `$secure({ sessionOnly: true })` refuse it, which includes creating,
 *   rotating and revoking keys
 * - 15-minute validation caching, and query param (`?api_key=`) and Bearer
 *   header support
 *
 * See the API keys guide (`docs/framework/1-guides/4-server/21-api-keys.md`).
 *
 * **Integration:**
 * A realm registers all of it with `features: { apiKeys: true }`. To enable
 * API key authentication for a plain issuer, register the resolver:
 *
 * ```ts
 * class MyApp {
 *   apiKeyService = $inject(ApiKeyService);
 *   issuer = $issuer({
 *     secret: env.APP_SECRET,
 *     resolvers: [this.apiKeyService.createResolver()],
 *   });
 * }
 * ```
 *
 * @module alepha.api.keys
 */
export const AlephaApiKeys = $module({
  name: "alepha.api.keys",
  imports: [AlephaBackground, AlephaApiJobs, AlephaApiAudits],
  services: [
    ApiKeyParameters,
    ApiKeyIpAllowlist,
    ApiKeyService,
    ApiKeyController,
    AdminApiKeyController,
    // Not gated on anything, the way `AuditJobs` sits in `AlephaApiAudits`:
    // the retention purge is infrastructure, not a feature (a flag gates a
    // surface, never a cleanup). An application registering this module
    // standalone against a plain `$issuer` therefore gains the jobs module's
    // `job_executions` table, exactly as `alepha/api/audits` already gives it.
    ApiKeyJobs,
    // Ungated for the same reason: an audit trail of credential events is a
    // security baseline, not a feature to switch on.
    ApiKeyAudits,
  ],
  // Registered by `$realm` when a realm has notifications too, never here:
  // this module does not pull the notifications module in.
  variants: [ApiKeyNotifications],
});
