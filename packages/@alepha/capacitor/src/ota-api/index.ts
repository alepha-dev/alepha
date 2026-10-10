import { $module } from "alepha";
import { AlephaApiFiles } from "alepha/api/files";
import { AlephaApiJobs } from "alepha/api/jobs";
import { AlephaSecurity } from "alepha/security";
import { AlephaServerRateLimit } from "alepha/server/rate-limit";

import { OtaAdminController } from "./controllers/OtaAdminController.ts";
import { OtaDeviceController } from "./controllers/OtaDeviceController.ts";
import { OtaPublishController } from "./controllers/OtaPublishController.ts";
import { OtaJobs } from "./jobs/OtaJobs.ts";
import { OtaPermissions } from "./security/OtaPermissions.ts";
import { OtaAdminService } from "./services/OtaAdminService.ts";
import { OtaBundleInspector } from "./services/OtaBundleInspector.ts";
import { OtaDownloadLinks } from "./services/OtaDownloadLinks.ts";
import { OtaPublishService } from "./services/OtaPublishService.ts";
import { OtaRetention } from "./services/OtaRetention.ts";
import { OtaUpdateService } from "./services/OtaUpdateService.ts";

// ---------------------------------------------------------------------------------------------------------------------

export { CAPACITOR_ORIGINS } from "alepha/server/cors";
export * from "./atoms/otaApiOptions.ts";
export * from "./controllers/OtaAdminController.ts";
export * from "./controllers/OtaDeviceController.ts";
export * from "./controllers/OtaPublishController.ts";
export * from "./entities/otaApps.ts";
export * from "./entities/otaBundles.ts";
export * from "./entities/otaChannels.ts";
export * from "./entities/otaDeviceOverrides.ts";
export * from "./entities/otaDevices.ts";
export * from "./jobs/OtaJobs.ts";
export * from "./schemas/otaAppCreateSchema.ts";
export * from "./schemas/otaAppResourceSchema.ts";
export * from "./schemas/otaAppUpdateSchema.ts";
export * from "./schemas/otaBundleResourceSchema.ts";
export * from "./schemas/otaChannelCohortSchema.ts";
export * from "./schemas/otaChannelCreateSchema.ts";
export * from "./schemas/otaChannelResourceSchema.ts";
export * from "./schemas/otaChannelUpdateSchema.ts";
export * from "./schemas/otaCohortResourceSchema.ts";
export * from "./schemas/otaDeviceResourceSchema.ts";
export * from "./schemas/otaFallbackSchema.ts";
export * from "./schemas/otaKillSchema.ts";
export * from "./schemas/otaOverrideCreateSchema.ts";
export * from "./schemas/otaOverrideResourceSchema.ts";
export * from "./schemas/otaPromoteSchema.ts";
export * from "./schemas/otaPublishResultSchema.ts";
export * from "./schemas/otaRollbackSchema.ts";
export * from "./schemas/otaRolloutSchema.ts";
export * from "./security/OtaPermissions.ts";
export * from "./services/OtaAdminService.ts";
export * from "./services/OtaBundleInspector.ts";
export * from "./services/OtaDownloadLinks.ts";
export * from "./services/OtaPublishService.ts";
export * from "./services/OtaRetention.ts";
export * from "./services/OtaUpdateService.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * The server side of live updates for a native shell's web layer, mounted
 * into the app's own Alepha backend: no hosted service, no Capgo account.
 *
 * - `POST /ota/updates`, `/ota/stats`, `/ota/channel` and the signed
 *   `GET /ota/bundles/:id/download?token=`: the endpoints the pinned updater
 *   (`@capgo/capacitor-updater` 8.52.1) calls, unauthenticated, bounded and
 *   throttled; see {@link OtaUpdateService} for how a bundle is chosen;
 * - `POST /ota/bundles`: where `alepha capacitor release` publishes, with an
 *   API key holding `ota:release` and listed on the app;
 * - `/api/ota/*`: the typed admin actions `@alepha/capacitor/ota-admin`
 *   renders, under `ota:read`, `ota:manage` and `ota:release`;
 * - a nightly retention job.
 *
 * Bundles are exact: one may run only on the native build numbers its
 * release lists, all of one native fingerprint, so a newer binary with other
 * plugins never receives a web layer it cannot run. Encryption is Capgo v2;
 * the server holds the app's public key, verifies and inspects every upload
 * with it, and never holds the publisher's private key.
 *
 * Needs a database (`alepha/orm`), file storage (`alepha/api/files`),
 * `OTA_DOWNLOAD_SECRET` in production, and API keys (`alepha/api/keys`, a
 * realm's `features.apiKeys`) for the publisher.
 *
 * @module alepha.capacitor.ota.api
 */
export const AlephaCapacitorOtaApi = $module({
  name: "alepha.capacitor.ota.api",
  imports: [
    AlephaSecurity,
    AlephaApiFiles,
    AlephaApiJobs,
    AlephaServerRateLimit,
  ],
  services: [
    OtaPermissions,
    OtaBundleInspector,
    OtaDownloadLinks,
    OtaUpdateService,
    OtaPublishService,
    OtaAdminService,
    OtaRetention,
    OtaDeviceController,
    OtaPublishController,
    OtaAdminController,
    OtaJobs,
  ],
});
