import { type Infer, z } from "alepha";

/**
 * What the pinned updater (`@capgo/capacitor-updater` 8.52.1) says about the
 * device in every request it sends: the update check, the stats batch and the
 * channel calls carry these fields, snake_case as the plugin writes them.
 *
 * It is telemetry, never authentication: a caller can put anything here, so
 * no field authorizes anything on its own. Unknown fields are dropped.
 *
 * `version_code` is the native build number (iOS `CFBundleVersion`, Android
 * `versionCode`), the identity OTA compatibility is decided on;
 * `version_build` is the store version string (`CFBundleShortVersionString`,
 * `versionName`), shown and never compared.
 */
export const otaDeviceSchema = z.object({
  /**
   * `ios` or `android`.
   */
  platform: z.enum(["ios", "android"]),

  /**
   * The plugin's per-install identifier. Stable for one install, never a
   * credential.
   */
  device_id: z.text({ maxLength: 128 }),

  /**
   * The native bundle identifier, e.g. `dev.alepha.mobile`.
   */
  app_id: z.text(),

  /**
   * The native build number the binary was built with.
   */
  version_code: z.text({ maxLength: 64 }),

  /**
   * The store version string, display only.
   */
  version_build: z.text({ maxLength: 64 }).optional(),

  /**
   * The web layer the device is running: a bundle version, or `builtin`.
   */
  version_name: z.text({ maxLength: 128 }),

  /**
   * The web layer that ran before, on some stats events.
   */
  old_version_name: z.text({ maxLength: 128 }).optional(),

  /**
   * The operating system version.
   */
  version_os: z.text({ maxLength: 64 }).optional(),

  /**
   * The updater's own version.
   */
  plugin_version: z.text({ maxLength: 64 }).optional(),

  /**
   * An identifier the app set, unused by the server.
   */
  custom_id: z.text().optional(),

  is_emulator: z.boolean().optional(),

  is_prod: z.boolean().optional(),

  install_source: z.text({ maxLength: 64 }).optional(),

  /**
   * The channel the device asked to follow (`setChannel`), honoured only
   * when the server marked that channel self-assignable.
   */
  defaultChannel: z.text({ maxLength: 64 }).optional(),

  /**
   * The channel named by a channel request.
   */
  channel: z.text({ maxLength: 64 }).optional(),

  /**
   * The first 20 characters of the device's public key, the plugin's key
   * identity.
   */
  key_id: z.text({ maxLength: 64 }).optional(),
});

export type OtaDevice = Infer<typeof otaDeviceSchema>;
