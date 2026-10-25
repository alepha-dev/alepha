import { capacitor } from "@alepha/capacitor/cli";
import { defineConfig } from "alepha/cli/config";

/**
 * A calculator with no backend: the smallest native app `@alepha/capacitor`
 * makes, and one that runs offline. See README.md.
 *
 * `apiUrl` is a placeholder. `alepha capacitor sync` refuses a shell without
 * one, but this app never calls it: no page has a loader, and there is no
 * `$client` and no auth module. `.invalid` is a reserved TLD that never
 * resolves, so a call added by mistake fails at once instead of reaching
 * somebody's server.
 */
export default defineConfig({
  dev: { port: 3314 },
  plugins: [
    capacitor({
      appId: "dev.alepha.calculator",
      appName: "Calculator",
      scheme: "alephacalc",
      apiUrl: "https://api.invalid",
      icon: { source: "public/favicon.svg", background: "#F97316" },
    }),
  ],
});
