import { defineConfig } from "vite";

export default defineConfig((env) => {
  return {
    plugins: [
      {
        name: "debug-resolve",
        enforce: "pre", // Run before other plugins
        resolveId(id, importer) {
          if (id === "perf_hooks" || id === "node:perf_hooks") {
            console.error(`\n⚠️  perf_hooks imported by: ${importer}\n`);
            process.exit(1);
          }
        },
      },
    ],
  };
});
