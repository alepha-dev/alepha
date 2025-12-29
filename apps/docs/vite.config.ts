import { viteAlepha } from "alepha/vite";
import { defineConfig } from "vite";
import { VitePWA as vitePWA } from "vite-plugin-pwa";
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
    vitePWA({
      registerType: "autoUpdate",
      devOptions: {
        enabled: true,
      },
      includeAssets: ["favicon.ico", "favicon.png", "apple-touch-icon.png"],
      manifest: {
        name: "Alepha Documentation",
        short_name: "Alepha Docs",
        description:
          "Documentation for Alepha - TypeScript Framework Made Easy",
        theme_color: "#1a1a2e",
        background_color: "#1a1a2e",
        display: "standalone",
        start_url: "/",
        icons: [
          {
            src: "icon-192.png",
            sizes: "192x192",
            type: "image/png",
          },
          {
            src: "icon-512.png",
            sizes: "512x512",
            type: "image/png",
          },
          {
            src: "icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff,woff2}"],
        runtimeCaching: [
          {
            // HTML pages - network first (always fresh content)
            urlPattern: /^https:\/\/alepha\.dev\/(?!.*\.(js|css|png|svg|woff2?|ico|webp|jpg|jpeg|gif)$).*/i,
            handler: "NetworkFirst",
            options: {
              cacheName: "alepha-pages-cache",
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 60 * 24, // 1 day fallback
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
          {
            // Static assets - cache first (fast, versioned by Vite)
            urlPattern: /^https:\/\/alepha\.dev\/.*\.(js|css|png|svg|woff2?|ico|webp|jpg|jpeg|gif)$/i,
            handler: "CacheFirst",
            options: {
              cacheName: "alepha-assets-cache",
              expiration: {
                maxEntries: 200,
                maxAgeSeconds: 60 * 60 * 24 * 30, // 30 days
              },
              cacheableResponse: {
                statuses: [0, 200],
              },
            },
          },
        ],
      },
    }),
  ],
});
