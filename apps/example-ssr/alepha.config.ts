import { defineConfig } from "alepha/cli";

export default defineConfig({
  platform: {
    environments: {
      prod: { adapter: "cloudflare" },
    },
  },
  build: {
    target: "cloudflare",
    sitemap: {
      hostname: "https://example-ssr.alepha.dev",
    },
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
