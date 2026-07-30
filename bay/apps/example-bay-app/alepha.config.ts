import { defineConfig } from "alepha/cli/config";
import { platform } from "alepha/cli/platform";

export default defineConfig({
  plugins: [
    platform({
      environments: {
        production: {
          adapter: "bay",
          // A Bay is a machine someone owns, so there is no global endpoint to
          // assume — unlike Cloudflare. Committed on purpose: it is a public
          // hostname, and the API key is what protects it. $BAY_ENDPOINT
          // overrides for a fork or a second Bay.
          endpoint: "https://admin.bay.alepha.dev",
          // No `domain`: Bay composes <project>.<base-domain> from the artifact
          // and its own configuration, which is the property worth keeping —
          // the same artifact deploys to any Bay without being edited.
        },
      },
    }),
  ],
});
