import { defineConfig, viteAlepha } from "@alepha/vite";

export default defineConfig({
  base: "/devtools",
  plugins: [
    viteAlepha({
      client: {
        prerender: true,
      },
    }),
  ],
  server: {
    proxy: {
      "/devtools/api": "http://localhost:5173",
    },
  },
});
