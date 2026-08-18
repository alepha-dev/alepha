import { defineConfig } from "alepha/cli/config";
import { platform } from "alepha/cli/platform";

export default defineConfig({
  // Dev ports mirror the e2e band in playwright.port.ts so there is one
  // mapping to remember, not two. Every app otherwise binds 5173.
  dev: { port: 3307 },
  plugins: [
    platform({
      environments: {
        production: {
          adapter: "bay",
          // The machine, reached over SSH with a key that is already shared.
          // Committed on purpose: it is a hostname, and the key is what
          // protects it. May be an alias from ~/.ssh/config; $BAY_HOST
          // overrides for a fork or a second Bay.
          host: "deploy@bay.alepha.dev",
          // No `domain`: Bay composes <project>.<base-domain> from the artifact
          // and its own configuration, which is the property worth keeping —
          // the same artifact deploys to any Bay without being edited.
        },
      },
    }),
  ],
});
