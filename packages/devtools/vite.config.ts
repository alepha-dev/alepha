import { defineConfig, viteAlepha } from "@alepha/vite";

export default defineConfig({
  base: "/devtools",
  plugins: [
    viteAlepha({
      client: {
        prerender: true,
      },
      serverEntry: "src/ui/main.server.ts",
    }),
  ],
});
