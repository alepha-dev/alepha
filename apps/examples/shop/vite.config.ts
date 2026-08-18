import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss()],
  server: {
    /*
     * The shop's dev server owns 5305 — mirroring the 3305 it owns in the e2e
     * band, so one app is one pair of digits everywhere.
     *
     * `ViteDevServerProvider` resolves the dev port as `SERVER_PORT` → this
     * value → 5173, so pinning it here is what stops the shop landing on
     * Vite's default. That default is shared ground: `apps/lore` documents
     * 5173 as its own dev URL, and the root `alepha dev` hands out 5173 + the
     * app's index across all fourteen apps under `apps/` — which reaches 5186,
     * hence a port well clear of that whole run.
     *
     * Two dev servers on one port is not a hypothetical here: several agents
     * work this repo at once, one git worktree each. `playwright.port.ts` has
     * the long version of what that costs.
     */
    port: 5305,
    /*
     * Name the collision instead of drifting past it. Vite's default is to walk
     * to the next free port, so a second `yarn dev` would quietly serve on 5306
     * while every browser tab, OAuth redirect and hand-run `curl` still aimed at
     * 5305 kept reaching the FIRST server — you would be reading one process and
     * editing another.
     *
     * With this on, the second boot prints `Error: Port 5305 is already in use`
     * and parks on "Waiting for file changes to retry", which is
     * `ViteDevServerProvider`'s normal startup-failure path: loud, and still
     * live once you free the port.
     */
    strictPort: true,
  },
});
