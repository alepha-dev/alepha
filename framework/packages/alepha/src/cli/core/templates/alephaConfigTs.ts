import type { InfraProvider } from "../schemas/infraProviderSchema.ts";

/**
 * Where a `--infra lore` project deploys: the Lore project, and the instance
 * when it is not `https://lore.alepha.dev`. Never an estate: which machine a
 * copy deploys to is chosen in Lore, where the estate is lent.
 */
export interface AlephaConfigLoreOptions {
  project: string;
  url?: string;
}

/**
 * Template for alepha.config.ts with documented options.
 *
 * Without an infra choice, the `plugins` array stays commented.
 * Uncommenting the `infra` entry opts in.
 */
export const alephaConfigTs = (
  opts: { infra?: InfraProvider; lore?: AlephaConfigLoreOptions } = {},
) => {
  const lore = opts.infra === "lore";
  const loreArgs = [
    `project: ${JSON.stringify(opts.lore?.project ?? "my-app")}`,
    ...(opts.lore?.url ? [`url: ${JSON.stringify(opts.lore.url)}`] : []),
  ].join(", ");
  const imports = lore
    ? `import { lore } from "@alepha/lore/cli";
import { infra } from "alepha/cli/infra";`
    : `${opts.infra ? "" : "// "}import { cloudflare, infra } from "alepha/cli/infra";`;
  return `import { defineConfig } from "alepha/cli/config";
${imports}

export default defineConfig({
  //
  // entry: {
  //   server: "src/main.server.ts",
  //   browser: "src/main.browser.ts",
  //   style: "src/main.css",
  // },
  //
  // \`alepha build\` produces dist/ with a manifest and runtime slices.
  // Node is the default. Declare more than one to ship the same app to
  // multiple runtimes; the first is primary.
  //
  // build: {
  //   runtime: ["node", "workerd"], // or "bun"; ["static"] for a static site
  // },
  //
  // \`alepha build --runtime workerd\` writes the Worker config without
  // cloud credentials. \`alepha pack\` archives dist/, \`alepha compile\`
  // creates a Bun binary, and \`alepha image\` builds a container image.
  // Run lint, typecheck, tests and migration checks locally; build and
  // integration checks separately before deploying, with CI as the gate.
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
  // \`alepha deploy\` targets the configured default (production unless
  // overridden): authenticate, provision, build, migrate, deploy, secrets.
  // Cloudflare can open its login flow automatically. Init does not log in.
  // Resources come from the app's declarations; no wrangler.toml to maintain.
${
  lore
    ? `  // Deployed through Lore: \`alepha deploy\` builds what the copy's estate
  // runs, pushes it, seals the local secrets into the copy and deploys. The
  // estate is chosen in Lore, never here.
  plugins: [
    infra({
      environments: {
        production: lore({ ${loreArgs} }),
      },
    }),
  ],`
    : opts.infra
      ? `  plugins: [
    infra({
      environments: {
        production: cloudflare(),
      },
    }),
  ],`
      : `  // plugins: [
  //   infra({
  //     environments: {
  //       production: cloudflare({ domain: "myapp.com" }),
  //       preview: cloudflare(), // workers.dev subdomain
  //     },
  //   }),
  // ],`
}
});
`;
};
