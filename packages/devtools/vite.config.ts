import { viteAlepha } from "alepha/vite";
import { defineConfig } from "vite";

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
