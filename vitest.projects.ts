import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { TestProjectInlineConfiguration } from "vitest/config";

const repoRoot = dirname(fileURLToPath(import.meta.url));

/**
 * The projects of one workspace, built the same way wherever they are read.
 *
 * Every workspace holding spec files owns a `vitest.config.ts` that calls this
 * and exports the result twice: as `projects`, which the root config spreads,
 * and as a default `defineConfig`, which is what a standalone `vitest run`
 * inside that workspace loads. One definition, two entry points, so
 * `yarn test` and `yarn w <workspace> test` cannot disagree about what a
 * workspace's tests are.
 *
 * ⚠️ The entries returned here are FLAT, and they have to stay that way. A
 * project config that declares `projects` of its own is not nested, it is
 * silently ignored: the parent collapses it into a single project, keeps the
 * parent's own `test` block, and runs every spec under it. Measured, not
 * assumed. That is what a browser spec running in the `node` environment looks
 * like, and it is why the jsdom half is a sibling entry here rather than a
 * nested project inside each workspace.
 *
 * Settings are stamped into every entry rather than inherited with
 * `extends: true`. Inheritance would resolve against the root config from the
 * root and against the workspace config standalone, which is two different
 * answers for the same project.
 */
export const workspaceProjects = (
  configUrl: string,
  options: WorkspaceProjectsOptions,
): TestProjectInlineConfiguration[] => {
  const root = dirname(fileURLToPath(configUrl));
  const alias = tsconfigAlias(root, options.name);

  const projects: TestProjectInlineConfiguration[] = [
    {
      resolve: { alias },
      test: {
        ...sharedTestOptions(),
        name: options.name,
        root,
        environment: "node",
        ...(options.include ? { include: options.include } : {}),
        exclude: [
          ...sharedExclude,
          "**/*.browser.spec.{ts,tsx}",
          "**/*.bun.spec.{ts,tsx}",
        ],
      },
    },
  ];

  if (options.jsdom) {
    projects.push({
      resolve: {
        alias,
        // A browser build is what a jsdom spec is testing, so the conditions
        // have to say so. This is also why a workspace's self-named tsconfig
        // path is skipped in `tsconfigAlias`: an alias resolves before the
        // exports map and would hand back the node entry point instead.
        conditions: ["browser", "module", "import", "default"],
        mainFields: ["browser", "module", "main"],
      },
      test: {
        ...sharedTestOptions(),
        name: `${options.name}:jsdom`,
        root,
        environment: "jsdom",
        include: ["**/*.browser.spec.{ts,tsx}"],
        exclude: sharedExclude,
        execArgv: ["--no-experimental-webstorage"],
        setupFiles: [resolve(repoRoot, "vitest.jsdom.setup.ts")],
      },
    });
  }

  return projects;
};

export interface WorkspaceProjectsOptions {
  /**
   * The project name, which is the workspace name.
   *
   * It is what `--project` filters on, so it is also the handle anything that
   * selects a subset of the suite has to use. A workspace with browser specs
   * gets a second project suffixed `:jsdom`, which means selecting one
   * workspace whole is `--project '<name>*'` rather than `--project <name>`.
   */
  name: string;

  /**
   * Whether this workspace has `*.browser.spec.{ts,tsx}` files.
   *
   * Declared rather than detected, and cross-checked by
   * `scripts/check-conventions.ts`: a workspace whose flag disagrees with
   * what is on disk fails the check. Detection alone would be silent in the
   * direction that matters, since a missing jsdom project does not fail, it
   * just runs nothing.
   */
  jsdom?: boolean;

  /**
   * Restrict the node project to these patterns, instead of Vitest's default
   * of every spec below the workspace root.
   *
   * Only the repository root needs it, and it needs it badly: that workspace's
   * root is every other workspace's parent, so the default would collect the
   * whole monorepo a second time, once more per project. The files that
   * genuinely live there are the repo-level tooling specs, and nothing else.
   */
  include?: string[];
}

/**
 * Everything a project needs regardless of which workspace it belongs to.
 */
const sharedTestOptions = () => ({
  testTimeout: 10_000,
  globals: true,
  onConsoleLog: (log: string) => {
    if (log.includes("was not wrapped in act(")) {
      return false;
    }
  },
  env: {
    // Do NOT set LOG_LEVEL here. When it is unset in test mode, Alepha's
    // logger buffers logs in memory and prints them to the console only when
    // a test fails (see packages/alepha/src/logger/index.ts). Setting any
    // LOG_LEVEL opts out of that and makes warn/error spam every passing test.
    //
    // ⚠️ `TZ` is applied before a *process* starts, so it works under the
    // default `forks` pool and silently does not under `threads`: a worker
    // thread inherits the parent's already-initialised timezone and setting
    // `process.env.TZ` inside one never re-runs tzset. Switching the pool
    // fails only on a machine that is not already in Europe/Paris, which is
    // to say it passes locally and fails on CI.
    TZ: "Europe/Paris",
    DATABASE_URL: "postgres://postgres:postgres@127.0.0.1:15432/postgres",
    S3_ENDPOINT: "http://127.0.0.1:19090",
    S3_REGION: "us-east-1",
    S3_ACCESS_KEY_ID: "mock",
    S3_SECRET_ACCESS_KEY: "mock",
    // The bucket the S3 specs create on the s3mock service before they run.
    S3_BUCKET_NAME: "alepha-test",
    REDIS_URL: "redis://localhost:16379",
  },
});

const sharedExclude = ["**/node_modules/**", "**/dist/**", "**/e2e/**"];

/**
 * A workspace's own `compilerOptions.paths`, as Vite aliases.
 *
 * This is the whole reason `@/` used to need a hand-written alias. The
 * framework resolves tsconfig paths in the dev server, the client build and
 * the server build (`ViteUtils.createTsconfigPathsPlugin`), and Vitest was the
 * one runtime that did not, so every workspace using `@/` had to restate the
 * mapping by hand or fail at import time. The root config restated it once,
 * repo-wide, pointing at `apps/lore/src` - which would have resolved the first
 * `@/` import written in `examples/shop` into Lore's source, silently.
 *
 * ⚠️ A path whose prefix is the workspace's OWN package name is skipped. Those
 * exist for TypeScript alone; the package's `exports` map already resolves the
 * same specifier and does it better, because an alias is applied before
 * conditions are and would flatten `browser` and `types` down to one file.
 * `@alepha/lore/sigil` is the live case: aliasing it hands a jsdom spec
 * `index.ts` where the exports map gives `index.browser.ts`.
 */
const tsconfigAlias = (
  root: string,
  workspaceName: string,
): Array<{ find: RegExp; replacement: string }> => {
  const file = resolve(root, "tsconfig.json");
  if (!existsSync(file)) {
    return [];
  }

  const paths = JSON.parse(readFileSync(file, "utf8"))?.compilerOptions?.paths;
  if (!paths) {
    return [];
  }

  const alias: Array<{ find: RegExp; replacement: string }> = [];

  for (const [key, targets] of Object.entries(paths)) {
    const target = Array.isArray(targets) ? targets[0] : undefined;
    if (!key.endsWith("/*") || typeof target !== "string") {
      continue;
    }

    const prefix = key.slice(0, -2);
    if (prefix === workspaceName) {
      continue;
    }

    alias.push({
      find: new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/`),
      replacement: `${resolve(root, target.slice(0, -2))}/`,
    });
  }

  return alias;
};
