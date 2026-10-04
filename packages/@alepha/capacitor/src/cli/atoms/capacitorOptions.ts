import { $atom, type Infer, z } from "alepha";

import { capacitorIdentitySchema } from "../schemas/capacitorIdentitySchema.ts";

/**
 * What `capacitor({ ... })` in `alepha.config.ts` declared.
 *
 * Unset until the plugin runs, which is how every `alepha capacitor` command
 * tells "this project has no native app" from a misconfigured one.
 */
export const capacitorOptions = $atom({
  name: "alepha.capacitor.options",
  description: "Native app configuration of @alepha/capacitor",
  schema: capacitorIdentitySchema
    .extend({
      /**
       * The native projects this app has. Both by default.
       */
      platforms: z.array(z.enum(["ios", "android"])).optional(),

      /**
       * Extra Capacitor configuration merged into the generated
       * `capacitor.config.ts`, typically plugin settings. `appId`, `appName`
       * and `webDir` are the plugin's and cannot be set here, and neither can
       * `server.url`, which would ship a WebView pointed at a server.
       */
      config: z.record(z.string(), z.any()).optional(),

      /**
       * Other installable apps built from this one, by name: each overrides
       * identity keys of the base (`appId`, `appName`, `scheme`, `apiUrl`,
       * `icon`, `iosTeamId`, `env`). Once any is declared, every command
       * names the one it works on with `--variant`, `base` included.
       */
      variants: z
        .record(z.string(), capacitorIdentitySchema.partial())
        .optional(),
    })
    .optional(),
});

export type CapacitorOptions = NonNullable<
  Infer<typeof capacitorOptions.schema>
>;

export type CapacitorPlatform = "ios" | "android";
