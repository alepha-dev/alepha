import { viteAlepha } from "alepha/vite";
import { defineConfig } from "vite";
import pkg from "../../packages/alepha/package.json" with { type: "json" };

process.env.VITE_BUILD_DATE = new Date().toISOString();
process.env.VITE_VERSION = pkg.version;

export default defineConfig({
  plugins: [
    viteAlepha({
      client: {
        precompress: true,
        prerender: true,
        sitemap: {
          hostname: "https://alepha.dev",
        },
      },
    }),
  ],
});
