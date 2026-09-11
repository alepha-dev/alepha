/**
 * Template for alepha.config.ts with documented options.
 *
 * The `plugins` array is emitted fully commented, so the project starts with
 * no plugin and uncommenting the `platform` entry is the whole opt-in.
 */
export const alephaConfigTs = () => {
  return `import { defineConfig } from "alepha/cli/config";
// import { platform } from "alepha/cli/platform";

export default defineConfig({
  //
  // entry: {
  //   server: "src/main.server.ts",
  //   browser: "src/main.browser.ts",
  //   style: "src/main.css",
  // },
  //
  // How \`alepha build\` packages dist/. Unset, you get "bare": the plain
  // Node server you run with \`node dist/index.js\`.
  //
  //   target: "bare"        dist/ only — deploy it yourself           (default)
  //          | "docker"     also writes a Dockerfile for dist/
  //          | "cloudflare" Workers bundle + wrangler config (forces workerd)
  //          | "static"     prerendered client only, no server
  //
  //   runtime: "node"       (default) | "bun" | "workerd"
  //
  // Pick "docker" and \`alepha build\` leaves a Dockerfile beside dist/ — that
  // is the whole container story, there is nothing else to write. For CI,
  // \`alepha verify\` is the one command worth running on a pull request: it
  // chains clean, lint, typecheck, test, migration check and build.
  //
  // build: {
  //   target: "docker",
  //   runtime: "node",
  // },
  //
  // Build metadata (version, commit, build date, runtime) is resolved for you
  // and served on \`GET /version\`, readable anywhere as \`alepha.meta\`. The
  // version comes from the git tag on the built commit, or "latest" when there
  // is none. Declare one yourself only if that is not the answer you want -
  // typically an app that deploys on every push, where tags exist only on
  // releases:
  //
  // meta: { version: pkg.version },
  //
  // Deploy to Cloudflare in ~10s: \`alepha platform up --env production\`
  // Requires \`wrangler login\` once. D1, R2, KV, Queues and cron triggers
  // are auto-provisioned from your $repository / $storage / $cache / $job
  // declarations — no wrangler.toml to maintain.
  // plugins: [
  //   platform({
  //     environments: {
  //       production: { adapter: "cloudflare", domain: "myapp.com" },
  //       preview:    { adapter: "cloudflare" }, // workers.dev subdomain
  //     },
  //   }),
  // ],
});
`;
};
