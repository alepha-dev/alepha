import { defineConfig } from "alepha/cli";

export default defineConfig({
  build: {
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
    docker: {},
  },
});
