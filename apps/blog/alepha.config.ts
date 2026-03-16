import { defineConfig } from "alepha/cli/config";

export default defineConfig({
  platform: {
    environments: {
      production: {
        domain: "blog.alepha.dev",
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
