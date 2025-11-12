import { viteAlepha } from "@alepha/vite";

export default {
  plugins: [
    viteAlepha({
      serverEntry: "./src/main.server.ts",
      vercel: {
        projectName: "alepha-roadmap",
        config: {
          crons: [
            {
              path: "/session/cleanup",
              schedule: "0 0 * * *", // Every day at midnight
            },
          ],
        },
      },
      client: {
        precompress: true,
      },
    }),
  ]
};
