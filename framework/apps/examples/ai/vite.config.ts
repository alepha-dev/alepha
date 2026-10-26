import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [tailwindcss()],
  server: {
    // Mirrors the 3315 this app owns in the dev band; strict, so a collision
    // is named instead of drifting to the next port.
    port: 5315,
    strictPort: true,
  },
});
