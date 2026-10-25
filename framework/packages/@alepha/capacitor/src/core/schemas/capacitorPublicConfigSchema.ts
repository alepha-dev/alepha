import { type Infer, z } from "alepha";

/**
 * The configuration a native shell's browser code may read, and nothing else.
 *
 * The `alepha capacitor` commands build it from `capacitor({ ... })` in
 * `alepha.config.ts` and hand it to the client bundle as the Vite `define`
 * `__ALEPHA_CAPACITOR__`: browser code has no other channel, since
 * `alepha.env` is empty in the browser. It is an allowlist. Whatever is here
 * ships in a file anyone with the app can read, so no secret, no backend
 * environment and no signing material may ever be added to it.
 */
export const capacitorPublicConfigSchema = z.object({
  /**
   * The native bundle identifier, e.g. `dev.alepha.mobile`.
   */
  appId: z.text(),

  /**
   * The variant this shell was built for, `base` when the app has none.
   */
  variant: z.text(),

  /**
   * The custom URL scheme deep links arrive on, e.g. `mobile` for
   * `mobile://app/notes`.
   */
  scheme: z.text(),

  /**
   * Where the web layer comes from: `bundled` for a shell built into the
   * binary, `dev` for a WebView pointed at a development server.
   */
  mode: z.enum(["bundled", "dev"]),

  /**
   * The origin of the API every host-less `$client` calls, e.g.
   * `https://api.example.com`. Absent only in development, where the shell is
   * served by the API itself.
   */
  apiUrl: z.text().optional(),

  /**
   * The live updater, when the app ships one (`capacitor({ ota })`): the
   * origin of the server mounting `@alepha/capacitor/ota-api`, `apiUrl`
   * unless declared apart. `@alepha/capacitor/ota` points the updater at its
   * `/ota` endpoints on boot; the public key stays in the native config.
   * Absent, `@alepha/capacitor/ota` stays inert.
   */
  ota: z
    .object({
      url: z.text(),
    })
    .optional(),

  /**
   * Public values the app declared for the browser, by name.
   */
  env: z.record(z.text(), z.text()),
});

/**
 * What a built shell knows about itself, baked in at build time and readable
 * by the browser code.
 */
export type CapacitorPublicConfig = Infer<typeof capacitorPublicConfigSchema>;
