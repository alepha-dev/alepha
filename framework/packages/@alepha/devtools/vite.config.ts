import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss()],
  server: {
    // Dev ports live in the 33xx band, documented in the root CLAUDE.md's port
    // table; `yarn check:conventions` keeps the two in step. The same port
    // `npx @alepha/devtools` tries first.
    port: 3310,
  },
});
