import { defineConfig, viteAlepha } from "@alepha/vite";

export default defineConfig({
  base: "/devtools",
  plugins: [
    viteAlepha({
      serverEntry: false,
    }),
  ],
  server: {
    proxy: {
      "/devtools/api": "http://localhost:5173",
    },
  },
});
