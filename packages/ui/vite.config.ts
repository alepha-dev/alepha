import { defineConfig, viteAlepha } from "alepha/vite";

export default defineConfig({
  plugins: [
    viteAlepha({
      serverEntry: "./sandbox/main.ts",
    }),
  ],
});
