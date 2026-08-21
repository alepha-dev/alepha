import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Alepha, Json } from "alepha";
import { CliProvider } from "alepha/command";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, expect, it } from "vitest";

import { version } from "../alephaPackageJson.ts";
import { InitCommand } from "../commands/init.ts";

/**
 * `alepha init --preset=<name>`.
 *
 * The `default` cases here are regression guards, not duplicates of
 * `init.spec.ts`: they pin the shape the preset branch must leave untouched.
 */
describe("alepha init --preset", () => {
  const createTestEnv = () => {
    const alepha = Alepha.create()
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider });

    return {
      fs: alepha.inject(MemoryFileSystemProvider),
      cli: alepha.inject(CliProvider),
      cmd: alepha.inject(InitCommand),
      json: alepha.inject(Json),
      shell: alepha.inject(MemoryShellProvider),
    };
  };

  /**
   * The exact command the scaffolder is expected to run. `MemoryShellProvider`
   * keys both its recorded calls and its configured errors on the whole
   * string, so the failure case has to name it in full.
   */
  const MIGRATION_COMMAND = "alepha db migrations create --name=initial_schema";

  const setupProject = async (
    fs: MemoryFileSystemProvider,
    json: Json,
    packageJson: Record<string, unknown> = {},
  ) => {
    await fs.writeFile(
      "/project/package.json",
      json.stringify({ name: "test-app", ...packageJson }),
    );
  };

  const readFile = async (fs: MemoryFileSystemProvider, path: string) =>
    (await fs.readFile(path)).toString();

  // ───────────────────────────────────────────────────────────────────────────
  // default preset
  // ───────────────────────────────────────────────────────────────────────────

  describe("default", () => {
    it("should keep main.css on bare tailwind", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { root: "/project" });

      const css = await readFile(fs, "/project/src/main.css");
      expect(css).toContain('@import "tailwindcss"');
      expect(css).not.toContain("@alepha/ui");
    });

    it("should not add @alepha/ui", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { root: "/project" });

      const pkg = await fs.readJsonFile<{
        dependencies: Record<string, string>;
      }>("/project/package.json");
      expect(pkg.dependencies["@alepha/ui"]).toBeUndefined();
    });

    it("should not write a realm", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { root: "/project" });

      expect(fs.wasWritten("/project/src/api/Realm.ts")).toBe(false);
    });

    it("should not describe a realm in AGENTS.md", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { root: "/project" });

      const agents = await readFile(fs, "/project/AGENTS.md");
      expect(agents).not.toContain("Realm.ts");
    });

    it("should be what an explicit --preset=default produces", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { argv: "--preset=default", root: "/project" });

      const css = await readFile(fs, "/project/src/main.css");
      expect(css).toContain('@import "tailwindcss"');
      expect(fs.wasWritten("/project/src/api/Realm.ts")).toBe(false);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // saas preset
  // ───────────────────────────────────────────────────────────────────────────

  describe("saas", () => {
    it("should add @alepha/ui pinned to the same version as alepha", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { argv: "--preset=saas", root: "/project" });

      const pkg = await fs.readJsonFile<{
        dependencies: Record<string, string>;
      }>("/project/package.json");
      expect(pkg.dependencies["@alepha/ui"]).toBe(`^${version}`);
      expect(pkg.dependencies.alepha).toBe(`^${version}`);
    });

    it("should point main.css at the @alepha/ui stylesheet", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { argv: "--preset=saas", root: "/project" });

      const css = await readFile(fs, "/project/src/main.css");
      expect(css).toContain('@import "@alepha/ui/styles.css"');
      // styles.css already imports tailwindcss; a second import is a duplicate.
      expect(css).not.toContain('@import "tailwindcss"');
    });

    it("should register the three routers in the web module", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { argv: "--preset=saas", root: "/project" });

      const web = await readFile(fs, "/project/src/web/index.ts");
      expect(web).toContain("AuthRouter");
      expect(web).toContain("AccountRouter");
      expect(web).toContain("AdminRouter");
      expect(web).toContain('@alepha/ui/components/account/account-router"');
    });

    it("should import the react modules the routers depend on", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { argv: "--preset=saas", root: "/project" });

      const web = await readFile(fs, "/project/src/web/index.ts");
      expect(web).toContain("AlephaReactAuth");
      expect(web).toContain("AlephaReactI18n");
      expect(web).toContain("AlephaReactUi");
    });

    it("should wire the orm and users modules into the api module", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { argv: "--preset=saas", root: "/project" });

      const api = await readFile(fs, "/project/src/api/index.ts");
      expect(api).toContain("AlephaOrm");
      expect(api).toContain("AlephaApiUsers");
      expect(api).toContain("Realm");
    });

    it("should write a realm declaring the admin:ui permission", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { argv: "--preset=saas", root: "/project" });

      const realm = await readFile(fs, "/project/src/api/Realm.ts");
      expect(realm).toContain("$realm(");
      expect(realm).toContain("$permission(");
      // AdminRouter's layout is gated on exactly this permission.
      expect(realm).toContain('group: "admin"');
      expect(realm).toContain('name: "ui"');
    });

    it("should document DATABASE_URL in .env.example", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { argv: "--preset=saas", root: "/project" });

      const env = await readFile(fs, "/project/.env.example");
      expect(env).toContain("DATABASE_URL");
    });

    /**
     * AGENTS.md opens with "Every Alepha project has the same layout. There
     * are no variants" — true of the skeleton, and misleading in a project
     * that also has a realm and three mounted routers. An agent that never
     * learns about `Realm.ts` edits the wrong file to change auth settings.
     */
    it("should describe the identity surface in AGENTS.md", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { argv: "--preset=saas", root: "/project" });

      const agents = await readFile(fs, "/project/AGENTS.md");
      expect(agents).toContain("Realm.ts");
      expect(agents).toContain("/admin");
      expect(agents).toContain("adminEmails");
    });

    /**
     * The templates are strings, so every other test here proves only that we
     * wrote the specifier we meant to write — not that anything answers to it.
     * A component renamed inside `@alepha/ui` would leave all of them green
     * and ship a preset whose generated project does not compile.
     *
     * Resolving against the workspace rather than `node_modules` is deliberate:
     * the published package trails main (`@alepha/ui@0.25.1` predates both the
     * account module and `admin-router`), and the preset pins
     * `@alepha/ui@^<same version as alepha>`, so what a scaffolded project
     * actually gets is whatever this source tree publishes next. That is the
     * tree worth asserting against.
     */
    it("should emit @alepha/ui import paths that exist in the workspace", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { argv: "--preset=saas", root: "/project" });

      const web = await readFile(fs, "/project/src/web/index.ts");
      const specifiers = [
        ...web.matchAll(/from "@alepha\/ui\/(components\/[^"]+)"/g),
      ].map((match) => match[1]);

      // Guards the guard: a template that stopped importing from @alepha/ui
      // would otherwise satisfy an empty loop.
      expect(specifiers).toHaveLength(3);

      const uiSrc = resolve(
        dirname(fileURLToPath(import.meta.url)),
        "../../../../../@alepha/ui/src",
      );
      for (const specifier of specifiers) {
        expect(
          existsSync(join(uiSrc, `${specifier}.tsx`)),
          `${specifier} does not exist in @alepha/ui`,
        ).toBe(true);
      }
    });

    it("should still scaffold the shared default files", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { argv: "--preset=saas", root: "/project" });

      expect(fs.wasWritten("/project/tsconfig.json")).toBe(true);
      expect(fs.wasWritten("/project/.oxlintrc.json")).toBe(true);
      expect(fs.wasWritten("/project/.oxfmtrc.json")).toBe(true);
      expect(fs.wasWritten("/project/src/main.server.ts")).toBe(true);
      expect(fs.wasWritten("/project/src/main.browser.ts")).toBe(true);
    });

    /**
     * Both option atoms default to `{}` and their `homeRouteName` /
     * `loginRouteName` defaults already match what the scaffold mounts, so the
     * entry points need no `alepha.set(...)`. Pinned as a test because the
     * cheap thing to do when adding chrome later is to paste it in here.
     */
    it("should leave the entry points free of router options wiring", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { argv: "--preset=saas", root: "/project" });

      const server = await readFile(fs, "/project/src/main.server.ts");
      const browser = await readFile(fs, "/project/src/main.browser.ts");
      expect(server).not.toContain("adminRouterOptionsAtom");
      expect(browser).not.toContain("adminRouterOptionsAtom");
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // initial migration
  //
  // `alepha verify` runs `db migrations check` unconditionally, and in
  // production `DatabaseProvider.migrate()` creates nothing when there is no
  // `migrations/` directory — it warns and returns. A preset that declares
  // entities and generates no migration therefore scaffolds a project that
  // fails its own documented CI command and, if deployed anyway, boots green
  // and 500s on its first query. The baseline is generated here so neither is
  // ever the starting state.
  // ───────────────────────────────────────────────────────────────────────────

  describe("initial migration", () => {
    it("should generate a baseline migration for the saas preset", async () => {
      const { fs, cli, cmd, json, shell } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { argv: "--preset=saas", root: "/project" });

      expect(shell.wasCalledMatching(/db migrations create/)).toBe(true);
    });

    /**
     * drizzle-kit names an unnamed migration from a random word list
     * (`20260815223535_youthful_swarm`). The first file in a project's history
     * is the one most often read by someone who did not write it.
     */
    it("should name it rather than take drizzle's random word pair", async () => {
      const { fs, cli, cmd, json, shell } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { argv: "--preset=saas", root: "/project" });

      expect(shell.wasCalledMatching(/--name=initial_schema/)).toBe(true);
    });

    it("should not generate one for the default preset", async () => {
      const { fs, cli, cmd, json, shell } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { root: "/project" });

      expect(shell.wasCalledMatching(/db migrations/)).toBe(false);
    });

    /**
     * Same contract as the lint pass: a project whose files are all on disk
     * must not be left half-scaffolded because a generated artifact failed.
     * The user can run the command again; they cannot easily undo a partial
     * init.
     */
    it("should not fail init when generation fails", async () => {
      const { fs, cli, cmd, json, shell } = createTestEnv();
      await setupProject(fs, json);
      shell.errors.set(MIGRATION_COMMAND, "drizzle-kit exploded");

      await expect(
        cli.run(cmd.init, { argv: "--preset=saas", root: "/project" }),
      ).resolves.not.toThrow();

      expect(shell.wasCalled(MIGRATION_COMMAND)).toBe(true);
    });

    /**
     * Ordering is pinned on both sides. After `install`, because it runs the
     * project's own `alepha` binary. Before the lint pass, because oxfmt
     * reformats drizzle's `snapshot.json`: generating afterwards leaves the
     * staged copy unformatted, and the user's first `lint` or `verify` then
     * dirties a project they have not touched.
     *
     * (That it also lands before `git add .` is structural rather than
     * asserted here — `git init` and `git add` go through
     * `AlephaCliUtils.exec`, which this provider does not record.)
     */
    it("should generate it after install and before the lint pass", async () => {
      const { fs, cli, cmd, json, shell } = createTestEnv();
      await setupProject(fs, json);

      await cli.run(cmd.init, { argv: "--preset=saas", root: "/project" });

      const index = (pattern: RegExp) =>
        shell.calls.findIndex((call: { command: string }) =>
          pattern.test(call.command),
        );
      const migration = index(/db migrations create/);
      expect(migration).toBeGreaterThan(-1);
      expect(migration).toBeGreaterThan(index(/install/));
      expect(migration).toBeLessThan(index(/lint/));
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  // rejections
  // ───────────────────────────────────────────────────────────────────────────

  describe("rejections", () => {
    /**
     * Asserts on the message rather than the throw alone: an unrecognised
     * flag rejects too, and that would keep this test green if `--preset`
     * were ever dropped. Naming the enum is what pins the validation.
     */
    it("should reject an unknown preset name", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json);

      await expect(
        cli.run(cmd.init, { argv: "--preset=blog", root: "/project" }),
      ).rejects.toThrow(/saas/);
    });

    /**
     * Expo owns its own client runtime, so `init` skips the web module for it
     * — and all three saas routers are React pages. Failing loudly beats
     * scaffolding an api-only project that silently ignored the flag.
     */
    it("should refuse the saas preset in an expo project", async () => {
      const { fs, cli, cmd, json } = createTestEnv();
      await setupProject(fs, json, { dependencies: { expo: "^52.0.0" } });

      await expect(
        cli.run(cmd.init, { argv: "--preset=saas", root: "/project" }),
      ).rejects.toThrow(/expo/i);
    });
  });
});
