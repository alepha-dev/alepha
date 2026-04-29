import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  base: "/__devtools",
  plugins: [tailwindcss()],
  server: {
    port: 3001,
    proxy: {
      "/__devtools/api": {
        target: "http://localhost:5173", // <- remember to run an app before running this
      },
    },
  },
});
