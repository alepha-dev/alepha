import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/__devtools",
  plugins: [tailwindcss()],
  server: {
    // Dev ports live in the 33xx band. This one sat on 3001, which belongs to
    // `apps/benchmark` (3001-3006), so running the benchmark and the devtools
    // UI at once collided. The band is documented in the root CLAUDE.md's port
    // table, and `yarn check:conventions` keeps the two in step.
    port: 3310,
    proxy: {
      "/__devtools/api": {
        target: "http://localhost:5173", // <- remember to run an app before running this
      },
    },
  },
});
