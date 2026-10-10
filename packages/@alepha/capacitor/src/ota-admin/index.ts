import { $module } from "alepha";

import { OtaAdminRouter } from "./OtaAdminRouter.ts";

// ---------------------------------------------------------------------------------------------------------------------

export * from "./components/OtaAppCreateDialog.tsx";
export * from "./components/OtaAppDetail.tsx";
export * from "./components/OtaApps.tsx";
export * from "./components/OtaBundleStatusBadge.tsx";
export * from "./components/OtaBundlesTab.tsx";
export * from "./components/OtaChannelCard.tsx";
export * from "./components/OtaChannelCreateDialog.tsx";
export * from "./components/OtaChannelsTab.tsx";
export * from "./components/OtaCohortDialog.tsx";
export * from "./components/OtaDevicesTab.tsx";
export * from "./components/OtaOverrideDialog.tsx";
export * from "./components/OtaOverridesTab.tsx";
export * from "./components/OtaPromoteDialog.tsx";
export * from "./components/OtaSettingsTab.tsx";
export * from "./components/OtaUploadDialog.tsx";
export * from "./i18n/otaAdminEn.ts";
export * from "./i18n/otaAdminFr.ts";
export * from "./OtaAdminRouter.ts";

// ---------------------------------------------------------------------------------------------------------------------

/**
 * The OTA back office, in an app's existing admin (`@alepha/ui/admin`), under
 * its own "Live updates" group: apps and their publisher keys, channels and
 * what each serves per compatibility cohort (rollout, fallback, rollback,
 * kill switch), bundles (exact native builds, key, digests, upload of a
 * pre-encrypted release, kill switch), devices seen in the last seven days,
 * and operator device overrides.
 *
 * Every page reads and writes through the typed actions of
 * `@alepha/capacitor/ota-api`, which enforce `ota:read`, `ota:manage` and
 * `ota:release` on the server; the pages only hide what the user cannot do.
 * Nothing here imports server code: the controller is a type.
 *
 * Mount it beside the app's admin, with `ota-api` on the server:
 *
 * ```ts
 * alepha.with(AlephaCapacitorOtaAdmin);
 * ```
 *
 * Labels are `ota.admin.*` keys with English defaults; {@link otaAdminFr}
 * (and {@link otaAdminEn} for an app falling back to another language) are
 * spread into the app's dictionaries.
 *
 * @module alepha.capacitor.ota.admin
 */
export const AlephaCapacitorOtaAdmin = $module({
  name: "alepha.capacitor.ota.admin",
  services: [OtaAdminRouter],
});
