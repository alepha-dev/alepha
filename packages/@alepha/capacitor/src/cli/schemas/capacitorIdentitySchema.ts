import { type Infer, z } from "alepha";

/**
 * What makes one installable app distinct from another: the keys a variant
 * may override.
 *
 * Kept apart from the rest of `capacitor({ ... })` so a variant is typed as
 * `Partial<CapacitorIdentity>` and cannot override anything that is not
 * identity.
 */
export const capacitorIdentitySchema = z.object({
  /**
   * The bundle identifier on iOS and the application id on Android, in
   * reverse-DNS form: `dev.alepha.mobile`.
   */
  appId: z
    .string()
    .regex(
      /^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$/,
      "appId is a reverse-DNS identifier such as dev.alepha.mobile",
    ),

  /**
   * The name shown under the icon.
   */
  appName: z.string().min(1),

  /**
   * The custom URL scheme the app answers deep links on, without `://`:
   * `mobile` for `mobile://app/notes`. Never `http`, `https`, `file` or
   * `capacitor`, which belong to the system or to the WebView itself.
   */
  scheme: z
    .string()
    .regex(
      /^[a-z][a-z0-9+.-]*$/,
      "scheme is a lowercase URL scheme such as mobile, without ://",
    )
    .refine(
      (scheme) => !["http", "https", "file", "capacitor"].includes(scheme),
      "scheme cannot be http, https, file or capacitor",
    ),

  /**
   * The origin of the API the shell calls, e.g. `https://api.example.com`.
   * Falls back to `PUBLIC_URL`. A bundled build refuses to run without one.
   */
  apiUrl: z.string().optional(),

  /**
   * A square source image of at least 1024 px (PNG or SVG), relative to the
   * project root, that the icons and the splash are generated from.
   */
  icon: z.string().optional(),

  /**
   * The Apple developer team that signs the iOS app (`DEVELOPMENT_TEAM`). A
   * free personal team is enough to install on your own phone.
   */
  iosTeamId: z.string().optional(),

  /**
   * Values the browser code of the shell may read, by name. Public by
   * definition: they ship inside the app. Never a secret.
   */
  env: z.record(z.string(), z.string()).optional(),
});

export type CapacitorIdentity = Infer<typeof capacitorIdentitySchema>;
