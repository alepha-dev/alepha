/**
 * Template for alepha.config.ts with documented options.
 *
 * `devtools` registers the dev-only inspection UI (floating cog →
 * `/__devtools/`). It is on by default for apps; `alepha init --no-devtools`
 * leaves it out entirely.
 *
 * The `plugins` array is emitted either active (devtools on) or fully
 * commented (devtools off) — never both, so uncommenting the `platform`
 * entry can't produce a duplicate `plugins` key.
 */
export const alephaConfigTs = (opts: { devtools?: boolean } = {}) => {
  const devtoolsImport = opts.devtools
    ? `import { devtools } from "alepha/cli/devtools";\n`
    : "";

  // Indented one level deeper when the array is live, so the commented
  // `platform(...)` entry lines up with `devtools()` beside it.
  const platformEntry = (prefix: string) => `${prefix}// platform({
${prefix}//   environments: {
${prefix}//     production: { adapter: "cloudflare", domain: "myapp.com" },
${prefix}//     preview:    { adapter: "cloudflare" }, // workers.dev subdomain
${prefix}//   },
${prefix}// }),`;

  const plugins = opts.devtools
    ? `  plugins: [
    // Dev-only inspection UI: atoms, modules, database, logs.
    // Floating cog at the bottom-left, or open /__devtools/ directly.
    // Use \`devtools({ hideButton: true })\` to drop the cog, keep the route.
    devtools(),
${platformEntry("    ")}
  ],`
    : `  // plugins: [
${platformEntry("  ")}
  // ],`;

  return `import { defineConfig } from "alepha/cli/config";
${devtoolsImport}// import { platform } from "alepha/cli/platform";

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
  // env: {
  //   VITE_BUILD_DATE: new Date().toISOString(),
  //   VITE_VERSION: pkg.version,
  // },
  //
  // Deploy to Cloudflare in ~10s: \`alepha platform up --env production\`
  // Requires \`wrangler login\` once. D1, R2, KV, Queues and cron triggers
  // are auto-provisioned from your $repository / $storage / $cache / $job
  // declarations — no wrangler.toml to maintain.
${plugins}
});
`;
};
