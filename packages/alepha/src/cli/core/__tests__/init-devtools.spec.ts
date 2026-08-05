import { Alepha, Json } from "alepha";
import { CliProvider } from "alepha/command";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, expect, it } from "vitest";
import { InitCommand } from "../commands/init.ts";

/**
 * Devtools is the best discovery surface a new user has — atoms, modules,
 * DB, logs — but it used to be an install-plus-config step nobody found.
 * The plugin is dev-only (Vite `transformIndexHtml` + lazy `ssrLoadModule`)
 * so shipping it by default costs nothing in a production bundle.
 */
describe("alepha init — devtools", () => {
  const createTestEnv = () => {
    const alepha = Alepha.create()
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider });

    return {
      fs: alepha.inject(MemoryFileSystemProvider),
      cli: alepha.inject(CliProvider),
      cmd: alepha.inject(InitCommand),
      json: alepha.inject(Json),
    };
  };

  const setupProject = async (fs: MemoryFileSystemProvider, json: Json) => {
    await fs.writeFile(
      "/project/package.json",
      json.stringify({ name: "test-app" }),
    );
  };

  const setupWorkspacePackage = async (
    fs: MemoryFileSystemProvider,
    json: Json,
  ) => {
    await fs.writeFile(
      "/workspace/package.json",
      json.stringify({ name: "monorepo", workspaces: ["packages/*"] }),
    );
    await fs.writeFile("/workspace/yarn.lock", "");
    await fs.writeFile("/workspace/biome.json", "{}");
    await fs.writeFile("/workspace/.editorconfig", "root=true");
    await fs.writeFile("/workspace/tsconfig.json", "{}");

    // The package needs its own package.json, or init treats the directory
    // as empty and scaffolds into a `my-app/` subdirectory instead.
    await fs.writeFile(
      "/workspace/packages/my-pkg/package.json",
      json.stringify({ name: "my-pkg" }),
    );
  };

  it("registers the devtools plugin in alepha.config.ts by default", async () => {
    const { fs, cli, cmd, json } = createTestEnv();
    await setupProject(fs, json);

    await cli.run(cmd.init, { root: "/project" });

    expect(
      fs.wasWrittenMatching(
        "/project/alepha.config.ts",
        /from "alepha\/cli\/devtools"/,
      ),
    ).toBe(true);
    expect(
      fs.wasWrittenMatching("/project/alepha.config.ts", /devtools\(\)/),
    ).toBe(true);
  });

  it("adds @alepha/devtools to devDependencies by default", async () => {
    const { fs, cli, cmd, json } = createTestEnv();
    await setupProject(fs, json);

    await cli.run(cmd.init, { root: "/project" });

    const pkg = await fs.readJsonFile<{
      devDependencies?: Record<string, string>;
    }>("/project/package.json");
    expect(pkg.devDependencies?.["@alepha/devtools"]).toBeDefined();
  });

  it("omits devtools entirely with --no-devtools", async () => {
    const { fs, cli, cmd, json } = createTestEnv();
    await setupProject(fs, json);

    await cli.run(cmd.init, { argv: "--no-devtools", root: "/project" });

    const pkg = await fs.readJsonFile<{
      devDependencies?: Record<string, string>;
    }>("/project/package.json");
    expect(pkg.devDependencies?.["@alepha/devtools"]).toBeUndefined();
    expect(
      fs.wasWrittenMatching("/project/alepha.config.ts", /devtools\(\)/),
    ).toBe(false);
  });

  /**
   * The endpoints are the half of devtools an agent can actually use — the UI
   * is for humans. Undocumented, they may as well not exist: nothing in the
   * project tells an assistant to look for them, so it reads source to answer
   * questions the running app would have answered exactly.
   */
  it("documents the devtools API in AGENTS.md by default", async () => {
    const { fs, cli, cmd, json } = createTestEnv();
    await setupProject(fs, json);

    await cli.run(cmd.init, { root: "/project" });

    expect(
      fs.wasWrittenMatching("/project/AGENTS.md", /__devtools\/api\/metadata/),
    ).toBe(true);
    expect(
      fs.wasWrittenMatching("/project/AGENTS.md", /__devtools\/api\/db/),
    ).toBe(true);
  });

  /**
   * Gated on the same flag as the plugin. Documenting an endpoint that was
   * never installed is worse than staying silent: it sends the reader to a
   * 404 and costs them the time to work out why.
   */
  it("leaves the devtools API out of AGENTS.md with --no-devtools", async () => {
    const { fs, cli, cmd, json } = createTestEnv();
    await setupProject(fs, json);

    await cli.run(cmd.init, { argv: "--no-devtools", root: "/project" });

    expect(fs.wasWrittenMatching("/project/AGENTS.md", /__devtools/)).toBe(
      false,
    );
  });

  it("skips devtools for a workspace package (no dev shell to attach to)", async () => {
    const { fs, cli, cmd, json } = createTestEnv();
    await setupWorkspacePackage(fs, json);

    await cli.run(cmd.init, { root: "/workspace/packages/my-pkg" });

    const pkg = await fs.readJsonFile<{
      devDependencies?: Record<string, string>;
    }>("/workspace/packages/my-pkg/package.json");
    expect(pkg.devDependencies?.["@alepha/devtools"]).toBeUndefined();
  });
});
