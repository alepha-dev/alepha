#!/usr/bin/env node
/**
 * Rehearses `npm i -g "@alepha/lore"` on all four package managers.
 *
 * `apps/e2e-cli` proves the tarball installs and the bin runs, but only under
 * npm and only as a local dependency. The headline of the standalone CLI is a
 * GLOBAL install, and a global install has no host project: nothing is there
 * to satisfy a peer, hoist a dependency, or supply `alepha`. That is the whole
 * reason `alepha` is a dependency of this package rather than a peer, and npm,
 * Yarn, pnpm and Bun each answer it differently.
 *
 * ## ⚠️ Why this cannot use the packed tarball
 *
 * Installing `lore.tgz` globally works, resolves `alepha@^0.28.0` from
 * **registry.npmjs.org**, and then dies:
 *
 * ```
 * SyntaxError: The requested module 'alepha/cli' does not provide an export
 *   named 'WorkspacePacker'
 * ```
 *
 * The published `alepha` is the previous release; the working tree's
 * `@alepha/lore` is built against the working tree's `alepha`. They ship
 * together (`release.yml` bumps every workspace in lockstep), so this is an
 * artefact of the rehearsal rather than a defect - but it means the rehearsal
 * has to publish BOTH packages to a registry it controls, or it tests a
 * combination that will never exist.
 *
 * Hence verdaccio. `compose.yml` runs it on 14873, config and reasoning in
 * `scripts/verdaccio.yaml`.
 *
 * ## The two traps
 *
 * - **`YARN_ENABLE_MIRROR=false`**, or yarn copies the previously published
 *   same-version zip out of its mirror and you test the old build believing
 *   otherwise. It cost three rounds once.
 * - **`npmMinimalAgeGate: 0`**. Yarn 4.18 quarantines any version younger than
 *   1440 minutes, so a version published a minute ago is refused with "the
 *   version for tag latest is quarantined". A perfectly good package looks
 *   broken.
 *
 * ## Leaves the registry as it found it
 *
 * Verdaccio is shared across worktrees, so both packages are unpublished on
 * the way out, whether or not the run succeeded.
 *
 * Usage:  node scripts/rehearse-lore-global.ts [--registry http://localhost:14873]
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * One package manager's answer to "install this globally and run its bin".
 *
 * `bin` is resolved after `install` has run, because three of the four put it
 * somewhere different and Yarn does not put it anywhere at all.
 */
interface Manager {
  name: string;
  /**
   * Skip rather than fail when the manager is not on this machine. Only the
   * absence is tolerated; a manager that is present and broken is a finding.
   */
  probe: string[];
  install: (dir: string, registry: string) => void;
  /**
   * `lore --help`, however this manager makes the binary reachable. Three of
   * the four leave a symlink in a directory of their own; Yarn leaves none at
   * all and is driven through `yarn lore`.
   */
  help: (dir: string) => string;
}

const REGISTRY = (() => {
  const flag = process.argv.indexOf("--registry");
  return flag === -1
    ? "http://localhost:14873"
    : (process.argv[flag + 1] ?? "http://localhost:14873");
})();

const ROOT = resolve(import.meta.dirname, "..");
/**
 * Read rather than hardcoded, so the unpublish that restores the shared
 * registry names the version this run actually published.
 */
const VERSION = JSON.parse(
  readFileSync(join(ROOT, "packages/@alepha/lore/package.json"), "utf8"),
).version as string;
const LAB = join(tmpdir(), "alepha-lore-rehearsal");
const TARBALLS = join(LAB, "tarballs");

/**
 * The five commands `lore --help` must list, and the ones it must never grow.
 *
 * The second list is the reason `WorkspacePacker` exists: `Alepha.inject`
 * registers the module that declares a service, so injecting one command from
 * `alepha/cli` would ship the whole Alepha CLI inside this binary under a
 * second name.
 */
const EXPECTED = ["quality", "artifacts", "releases", "login", "logout"];
const FORBIDDEN = ["build", "dev", "pack", "verify", "typecheck"];

/**
 * Blanked, not merely unset. Whoever runs this by hand has almost certainly
 * exported the real ones, and the help output must not depend on that.
 */
const CLEAN_ENV: Record<string, string> = {
  ...process.env,
  CLAUDECODE: "",
  LORE_PROJECT: "",
  LORE_API_KEY: "",
  NO_COLOR: "1",
  FORCE_COLOR: "0",
};

const sh = (
  command: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string> } = {},
): string =>
  execFileSync(command, args, {
    cwd: options.cwd ?? ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...CLEAN_ENV, ...options.env },
    maxBuffer: 64 * 1024 * 1024,
  });

const MANAGERS: Manager[] = [
  {
    name: "npm",
    probe: ["npm", "--version"],
    install: (dir, registry) => {
      sh("npm", [
        "install",
        "-g",
        "--prefix",
        dir,
        "@alepha/lore",
        "--registry",
        registry,
      ]);
    },
    help: (dir) => sh(join(dir, "bin", "lore"), ["--help"], { cwd: dir }),
  },
  {
    name: "pnpm",
    probe: ["corepack", "pnpm", "--version"],
    install: (dir, registry) => {
      // pnpm refuses to install globally unless its own bin directory is on
      // PATH, which is a real check rather than an annoyance: without it the
      // install would succeed and the binary would be unreachable.
      sh(
        "corepack",
        [
          "pnpm",
          "add",
          "-g",
          "@alepha/lore",
          "--registry",
          registry,
          "--store-dir",
          join(dir, "store"),
        ],
        {
          cwd: LAB,
          env: {
            PNPM_HOME: join(dir, "home"),
            PATH: `${join(dir, "home")}:${process.env.PATH ?? ""}`,
          },
        },
      );
    },
    help: (dir) => sh(join(dir, "home", "lore"), ["--help"], { cwd: dir }),
  },
  {
    name: "bun",
    probe: ["bun", "--version"],
    install: (dir, registry) => {
      sh("bun", ["add", "-g", "@alepha/lore", "--registry", registry], {
        cwd: LAB,
        env: { BUN_INSTALL: dir },
      });
    },
    help: (dir) => sh(join(dir, "bin", "lore"), ["--help"], { cwd: dir }),
  },
  {
    // ⚠️ Yarn 4 has no global install at all - `yarn global add` was removed.
    // The Yarn-shaped equivalent is a project dependency, which is also the
    // shape every workspace in this repository uses, so it is worth proving
    // either way.
    name: "yarn",
    probe: ["corepack", "yarn", "--version"],
    install: (dir, registry) => {
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "package.json"),
        `${JSON.stringify(
          {
            name: "lore-rehearsal",
            version: "1.0.0",
            private: true,
            packageManager: "yarn@4.18.0",
          },
          null,
          2,
        )}\n`,
      );
      writeFileSync(
        join(dir, ".yarnrc.yml"),
        [
          "nodeLinker: node-modules",
          `npmRegistryServer: "${registry}"`,
          "unsafeHttpWhitelist:",
          "  - localhost",
          "enableGlobalCache: false",
          `cacheFolder: "${join(dir, "cache")}"`,
          // The two traps, spelled out in the file rather than in an env var
          // so a human re-running the install by hand inherits them.
          "enableMirror: false",
          "npmMinimalAgeGate: 0",
          "enableImmutableInstalls: false",
          "",
        ].join("\n"),
      );
      sh("corepack", ["yarn", "add", "@alepha/lore"], {
        cwd: dir,
        env: { YARN_ENABLE_MIRROR: "false" },
      });
    },
    help: (dir) => sh("corepack", ["yarn", "lore", "--help"], { cwd: dir }),
  },
];

const publish = (file: string): void => {
  sh("npm", [
    "publish",
    join(TARBALLS, file),
    "--registry",
    REGISTRY,
    `--//${REGISTRY.replace(/^https?:\/\//, "")}/:_authToken=rehearsal`,
  ]);
};

const unpublish = (spec: string): void => {
  try {
    sh("npm", [
      "unpublish",
      spec,
      "--registry",
      REGISTRY,
      `--//${REGISTRY.replace(/^https?:\/\//, "")}/:_authToken=rehearsal`,
      "--force",
    ]);
  } catch {
    // Already absent, or never published because an earlier step threw. Either
    // way there is nothing to restore, and a failure here must not mask the
    // failure that caused it.
  }
};

const main = (): void => {
  for (const built of [
    "packages/alepha/dist/bin/index.js",
    "packages/@alepha/lore/dist/bin/index.js",
  ]) {
    if (!existsSync(join(ROOT, built))) {
      console.error(`${built} is missing. Run \`yarn build\` first.`);
      process.exit(1);
    }
  }

  rmSync(LAB, { recursive: true, force: true });
  mkdirSync(TARBALLS, { recursive: true });

  // `yarn pack`, not `npm pack`: the `publishConfig` overrides that repoint
  // `bin` and the `exports` map at `dist/` are a yarn extension.
  sh("yarn", ["workspace", "alepha", "pack", "-o", join(TARBALLS, "a.tgz")]);
  sh("yarn", [
    "workspace",
    "@alepha/lore",
    "pack",
    "-o",
    join(TARBALLS, "l.tgz"),
  ]);

  const failures: string[] = [];
  try {
    publish("a.tgz");
    publish("l.tgz");

    for (const manager of MANAGERS) {
      try {
        sh(manager.probe[0], manager.probe.slice(1), { cwd: LAB });
      } catch {
        console.log(`- ${manager.name}: not installed, skipped`);
        continue;
      }

      const dir = join(LAB, manager.name);
      mkdirSync(dir, { recursive: true });
      try {
        manager.install(dir, REGISTRY);
        const help = manager.help(dir);

        const missing = EXPECTED.filter((name) => !help.includes(name));
        const leaked = FORBIDDEN.filter((name) =>
          help.includes(`lore ${name}`),
        );
        if (missing.length > 0 || leaked.length > 0) {
          failures.push(
            `${manager.name}: missing [${missing.join(", ")}], leaked [${leaked.join(", ")}]`,
          );
        } else {
          console.log(`- ${manager.name}: lore --help lists the five commands`);
        }
      } catch (error) {
        failures.push(`${manager.name}: ${(error as Error).message}`);
      }
    }
  } finally {
    unpublish(`@alepha/lore@${VERSION}`);
    unpublish(`alepha@${VERSION}`);
    rmSync(LAB, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.error(`\n${failures.length} failure(s):\n${failures.join("\n")}`);
    process.exit(1);
  }
  console.log("\nAll four package managers reach the `lore` binary.");
};

main();
