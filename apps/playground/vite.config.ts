import { viteAlepha } from "@alepha/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    viteAlepha({
      serverEntry: "src/main.server.ts",
    }),
  ],
});
