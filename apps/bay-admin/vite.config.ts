import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

/**
 * `@alepha/ui/styles.css` is Tailwind v4, so the Tailwind plugin has to be
 * registered for any of its utility classes to be emitted. Without it the build
 * still succeeds and the stylesheet still loads with a 200 — it just contains
 * none of the utilities, so every page renders completely unstyled.
 */
export default defineConfig({
  plugins: [tailwindcss()],
});
