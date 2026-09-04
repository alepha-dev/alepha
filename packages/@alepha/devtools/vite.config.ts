import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/__devtools",
  plugins: [tailwindcss()],
  server: {
    // Dev ports live in the 33xx band, documented in the root CLAUDE.md's port
    // table; `yarn check:conventions` keeps the two in step.
    port: 3310,
    proxy: {
      "/__devtools/api": {
        target: "http://localhost:5173", // <- remember to run an app before running this
      },
    },
  },
});
