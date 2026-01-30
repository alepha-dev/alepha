import { defineConfig } from "vite";

export default defineConfig((env) => {
  return {
    plugins: [
      {
        /**
         * Test plugin to ensure that 'perf_hooks' is not imported
         * in the server build. If it is, the build will fail
         * with an error message indicating where it was imported from.
         *
         * We do this to double-check that we build server as "workerd" so
         * "postgres" module does not try to pull in "perf_hooks".
         */
        name: "debug-resolve",
        enforce: "pre", // Run before other plugins
        resolveId(id, importer) {
          if (id === "perf_hooks" || id === "node:perf_hooks") {
            console.error(`\n⚠️  perf_hooks imported by: ${importer}\n`);
            console.log(
              "If you see this, it means project 'example-ssr' has a regression in its server build.",
            );
            process.exit(1);
          }
        },
      },
    ],
  };
});
