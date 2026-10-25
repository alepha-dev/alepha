import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss()],
  server: {
    /*
     * Mirrors the 3307 this app owns in the dev band, so one app is one pair of
     * digits everywhere. `ViteDevServerProvider` resolves the dev port as
     * `SERVER_PORT` → this value → 5173, so pinning it here is what stops the
     * app landing on Vite's shared default.
     */
    port: 5307,
    /*
     * Name the collision instead of drifting past it: Vite's default is to walk
     * to the next free port, which would leave you reading one process and
     * editing another.
     */
    strictPort: true,
  },
});
