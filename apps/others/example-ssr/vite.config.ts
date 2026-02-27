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
          const denyList = [
            "readline",
            "node:readline",
            "readline/promises",
            "node:readline/promises",
            "cluster",
            "node:cluster",
            "perf_hooks",
            "node:perf_hooks",
            "child_process",
            "node:child_process",
          ];

          if (denyList.includes(id)) {
            const who = denyList.find((moduleName) => moduleName === id);
            console.error(`\n⚠️  ${who} imported by: ${importer}\n`);
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
