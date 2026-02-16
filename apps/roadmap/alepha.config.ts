import { defineConfig } from "alepha/cli";

export default defineConfig({
  build: {
    target: "vercel",
    vercel: {
      projectName: "alepha-roadmap",
      config: {
        crons: [
          {
            path: "/session/cleanup",
            schedule: "0 0 * * *",
          },
        ],
      },
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
