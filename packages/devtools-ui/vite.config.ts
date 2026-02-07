import { defineConfig } from "vite";

export default defineConfig({
  base: "/__devtools",
  server: {
    port: 3001,
    proxy: {
      "/__devtools/api": {
        target: "http://localhost:3000",
      },
    },
  },
});
