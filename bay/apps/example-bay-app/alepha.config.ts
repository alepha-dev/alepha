import { defineConfig } from "alepha/cli/config";
import { platform } from "alepha/cli/platform";

export default defineConfig({
  // Dev ports live in the 33xx band, which `playwright.port.ts` keeps strictly
  // DISJOINT from the 4300-4999 e2e band. The two used to be the same number,
  // and a running `yarn dev` was then adopted by the e2e suite. Every app
  // without a `dev.port` binds 5173.
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
