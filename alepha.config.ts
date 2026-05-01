import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { type Alepha, t } from "alepha";
import { changelogOptions } from "alepha/cli";
import { $command } from "alepha/command";

export default (alepha: Alepha) => {
  // Type-safe changelog configuration
  alepha.set(changelogOptions, {
    ignore: [
      "project",
      "tests",
      "docs",
      "release",
      "task",
      "roadmap",
      "roadmap/api",
    ],
  });

  return {
    convert: $command({
      description:
        "Convert package.json exports between TypeScript ('ts') and JavaScript ('js') format. Defaults to the opposite of the current format.",
      args: t.optional(t.text()),
      handler: async ({ args }) => {
        await convertExports(args);
      },
    }),
    clean: $command({
      description: "Will remove all generated files.",
      handler: async ({ run }) => {
        await convertExports("ts");

        await run.rm([
          `coverage`,
          `apps/*/playwright-report`,
          `apps/*/test-results`,
          `apps/*/dist`,
          `apps/*/node_modules`,
          `apps/*/coverage`,
          `packages/*/dist`,
          `packages/*/node_modules`,
          `packages/*/coverage`,
        ]);

        // When CI=true, yarn might create an immutable install, which is cool, but we don't need that here
        process.env.YARN_ENABLE_IMMUTABLE_INSTALLS = "false";

        await run("yarn");
      },
    }),
    verify: $command({
      aliases: ["v"],
      description: "Run linter, checker and tests.",
      handler: async ({ run }) => {
        // We need to force CI environment
        // -> tsdown has different behavior when run in CI
        process.env.CI = "true";

        await run(`yarn clean`);
        await run(`yarn copy`);
        await run(`yarn lint`);
        await run([`yarn typecheck`, `yarn test`, `yarn check-dependencies`]);
        await run(`yarn build`);

        // HACK: remove vite cache to prevent stale cache issues in e2e tests
        await run.rm([`apps/*/node_modules`]);
        await run([`yarn e2e`, `yarn e2e-cli`]);

        await run(`cd apps/docs && yarn alepha gen:llms`);
        await run(`yarn clean`);
        await run(`yarn copy`);
        await run(`yarn`);
      },
    }),
  };
};

/**
 * Convert exports in package.json to the specified format.
 *
 * If you want to develop in TypeScript, you can convert the exports to "ts" format.
 * It will expose package.json as TypeScript mono-repo friendly.
 *
 * If you want to publish the package, you can convert the exports to "js" format.
 * It will expose package.json as JavaScript universal package.
 *
 * If you don't specify the format, it will convert the exports to the opposite format.
 *
 * Basic usage:
 * - clean project
 * - convert to js
 * - build project
 * - convert to ts
 */
async function convertExports(to?: string) {
  const root = join(process.cwd(), "packages");
  const entries = await readdir(root);

  const packages: string[] = [];
  for (const entry of entries) {
    if (entry.startsWith("@")) {
      const scoped = await readdir(join(root, entry));
      for (const sub of scoped) {
        packages.push(join(entry, sub));
      }
    } else {
      packages.push(entry);
    }
  }

  console.log(`Converting exports to ${to ?? "opposite"}`);

  for (const name of packages) {
    try {
      const pkgPath = join(root, name, "package.json");
      const json = await readFile(pkgPath, "utf-8");
      const pkg = JSON.parse(json);

      if (
        pkg.private ||
        !pkg.scripts?.build ||
        (!pkg.main?.includes("dist") && !pkg.main?.includes("src") && !pkg.bin)
      ) {
        continue;
      }

      const action = to ?? (pkg.exports ? "ts" : "js");
      if (action === "ts") {
        const replace = (str: any) =>
          String(str).replace("dist/", "src/").replace(".js", ".ts");
        pkg.main = pkg.main.replace(".js", ".ts").replace("dist/", "src/");
        pkg.types = pkg.types.replace(".d.ts", ".ts").replace("dist/", "src/");
        pkg.module = undefined;
        if (pkg.browser) {
          pkg.browser = "./src/index.browser.ts";
        }
        if (pkg.bin) {
          if (typeof pkg.bin === "string") {
            pkg.bin = replace(pkg.bin);
          } else {
            for (const [key, value] of Object.entries(pkg.bin)) {
              pkg.bin[key] = replace(value);
            }
          }
        }
        if (pkg.exports) {
          for (const value of Object.values(
            pkg.exports as Record<string, any>,
          )) {
            if (typeof value === "object") {
              value.types = value.types
                .replace("dist/", "src/")
                .replace("index.d.ts", "index.ts");
              value.import = replace(value.import);
              if (value.browser) {
                value.browser = replace(value.browser);
              }
              if (value.workerd) {
                value.workerd = replace(value.workerd);
              }
              if (value["react-native"]) {
                value["react-native"] = replace(value["react-native"]);
              }
              value.default = value.import;
            }
          }
        }
      } else {
        const replace = (str: any) =>
          String(str).replace("src/", "dist/").replace(".ts", ".js");
        pkg.main = pkg.main.replace(".ts", ".js").replace("src/", "dist/");
        pkg.types = pkg.types.replace(".ts", ".d.ts").replace("src/", "dist/");
        if (pkg.browser) {
          pkg.browser = {
            "./dist/index.js": "./dist/index.browser.js",
          };
          pkg.exports["."].browser = "./dist/index.browser.js";
        }
        if (pkg.bin) {
          if (typeof pkg.bin === "string") {
            pkg.bin = replace(pkg.bin);
          } else {
            for (const [key, value] of Object.entries(pkg.bin)) {
              pkg.bin[key] = replace(value);
            }
          }
        }
        if (pkg.exports) {
          for (const value of Object.values(
            pkg.exports as Record<string, any>,
          )) {
            if (typeof value === "object") {
              if (value.require) {
                value.require = undefined;
              }

              value.types = value.types
                .replace("src/", "dist/")
                .replace(".ts", ".d.ts");
              value.import = replace(value.import);
              if (value.browser) {
                value.browser = replace(value.browser);
              }
              if (value.workerd) {
                value.workerd = replace(value.workerd);
              }
              if (value["react-native"]) {
                value["react-native"] = replace(value["react-native"]);
              }
              value.default = value.import;
            }
          }
        }
      }
      await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
      console.log(`Patched ${name} to ${action}`);
    } catch (error) {
      console.error(`Failed to patch ${name}`, error);
    }
  }
}
