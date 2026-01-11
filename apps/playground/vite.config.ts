import { viteAlepha } from "alepha/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    viteAlepha({
      client: {
        precompress: true,
      },
    }),
  ],
  server: {
    host: "0.0.0.0",
  },
});
