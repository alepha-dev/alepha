import { $module } from "alepha";
import { AlephaApiJobs } from "alepha/api/jobs";
import { AlephaBackground } from "alepha/background";

import { AdminApiKeyController } from "./controllers/AdminApiKeyController.ts";
import { ApiKeyController } from "./controllers/ApiKeyController.ts";
import { ApiKeyJobs } from "./jobs/ApiKeyJobs.ts";
import { ApiKeyParameters } from "./parameters/ApiKeyParameters.ts";
import { ApiKeyService } from "./services/ApiKeyService.ts";

export * from "./controllers/AdminApiKeyController.ts";
export * from "./controllers/ApiKeyController.ts";
export * from "./entities/apiKeyEntity.ts";
export * from "./jobs/ApiKeyJobs.ts";
export * from "./parameters/ApiKeyParameters.ts";
export * from "./schemas/adminApiKeyOwnerSchema.ts";
export * from "./schemas/adminApiKeyQuerySchema.ts";
export * from "./schemas/adminApiKeyResourceSchema.ts";
export * from "./schemas/apiKeyExpiresInSchema.ts";
export * from "./schemas/apiKeyStatusSchema.ts";
export * from "./schemas/createApiKeyBodySchema.ts";
export * from "./schemas/createApiKeyResponseSchema.ts";
export * from "./schemas/listApiKeyItemSchema.ts";
export * from "./schemas/listApiKeyResponseSchema.ts";
export * from "./schemas/revokeApiKeyParamsSchema.ts";
export * from "./schemas/revokeApiKeyResponseSchema.ts";
export * from "./services/ApiKeyService.ts";

/**
 * API key management module for programmatic access.
 *
 * **Features:**
 * - Create API keys with role snapshots
 * - List and revoke API keys
 * - 15-minute validation caching
 * - Query param (?api_key=) and Bearer header support
 *
 * **Integration:**
 * To enable API key authentication for an issuer, register the resolver:
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
  imports: [AlephaBackground, AlephaApiJobs],
  services: [
    ApiKeyParameters,
    ApiKeyService,
    ApiKeyController,
    AdminApiKeyController,
    // Not gated on anything, the way `AuditJobs` sits in `AlephaApiAudits`:
    // the retention purge is infrastructure, not a feature (a flag gates a
    // surface, never a cleanup). An application registering this module
    // standalone against a plain `$issuer` therefore gains the jobs module's
    // `job_executions` table, exactly as `alepha/api/audits` already gives it.
    ApiKeyJobs,
  ],
});
