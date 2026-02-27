import { defineConfig } from "alepha/cli";

export default defineConfig({
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
