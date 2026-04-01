import { defineConfig } from "alepha/cli/config";
import { AlephaCliDevtoolsPlugin } from "alepha/cli/devtools";
import { AlephaCliPlatformPlugin } from "alepha/cli/platform";

export default defineConfig({
  services: [AlephaCliPlatformPlugin, AlephaCliDevtoolsPlugin],
  platform: {
    environments: {
      production: {
        domain: "roadmap.alepha.dev",
        adapter: "cloudflare",
      },
      staging: {
        domain: "roadmap-staging.alepha.dev",
        adapter: "cloudflare",
      },
    },
  },
  build: {
    cloudflare: {
      config: {
        observability: {
          logs: {
            enabled: true,
            head_sampling_rate: 1,
            invocation_logs: true,
            persist: true,
          },
        },
      },
    },
  },
});
