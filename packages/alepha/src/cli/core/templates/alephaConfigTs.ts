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
  // env: {
  //   VITE_BUILD_DATE: new Date().toISOString(),
  //   VITE_VERSION: pkg.version,
  // },
  //
  // // Deploy to Cloudflare in ~10s: \`alepha platform up --env production\`
  // // Requires \`wrangler login\` once. D1, R2, KV, Queues and cron triggers
  // // are auto-provisioned from your $repository / $bucket / $cache / $queue
  // // / $scheduler primitives — no wrangler.toml to maintain.
  // platform: {
  //   environments: {
  //     production: { adapter: "cloudflare", domain: "myapp.com" },
  //     preview:    { adapter: "cloudflare" }, // workers.dev subdomain
  //   },
  // },
});
`;
};
