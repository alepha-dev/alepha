import { defineConfig } from "vite";

export default defineConfig({
  base: "/devtools",
  server: {
    proxy: {
      "/devtools/api": "http://localhost:5173",
    },
  },
});
