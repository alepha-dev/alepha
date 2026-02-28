/**
 * Template for alepha.config.ts with documented options.
 */
export const alephaConfigTs = () => {
  return `import { defineConfig } from "alepha/cli/config";

export default defineConfig({
  //
  // entry: {
  //   server: "src/main.server.ts",
  //   browser: "src/main.browser.ts",
  //   style: "src/main.css",
  // },
  //
  // build: {
  //   target: "docker",
  //   runtime: "node",
  // },
  //
  // platform: {
  //   environments: {
  //     production: { adapter: "cloudflare" },
  //   },
  // },
  //
  // env: {
  //   VITE_BUILD_DATE: new Date().toISOString(),
  //   VITE_VERSION: pkg.version,
  // },
});
`;
};
