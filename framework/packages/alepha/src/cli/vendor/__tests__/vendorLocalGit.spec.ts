import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { Alepha } from "alepha";
import { CliProvider } from "alepha/command";
import {
  FileSystemProvider,
  NodeFileSystemProvider,
  NodeShellProvider,
  ShellProvider,
} from "alepha/system";
import { afterEach, beforeEach, describe, it } from "vitest";

import { vendorOptions } from "../atoms/vendorOptions.ts";
import { VendorCommand } from "../commands/VendorCommand.ts";
import { VendorService } from "../services/VendorService.ts";

class TestVendorCommand extends VendorCommand {
  public testSync = this.sync;
}

/**
 * The whole flow with the real git and the real file system, against a
 * repository created in a temp directory: no network, no real remote.
 */
describe("alepha vendor, against a local git repository", () => {
  let dir: string;
  let remote: string;
  let project: string;

  const git = (...args: string[]) =>
    execFileSync(
      "git",
      ["-c", "user.name=spec", "-c", "user.email=spec@example.app", ...args],
      { cwd: join(dir, "remote"), stdio: "pipe", env: gitEnv() },
    );

  /**
   * The environment without any `GIT_*` variable (`GIT_DIR`,
   * `GIT_WORK_TREE`, `GIT_INDEX_FILE`...): a run started from a git hook
   * carries them, and git would then act on that repository, not on this
   * one.
   */
  const gitEnv = () =>
    Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
    );

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "alepha-vendor-spec-"));
    project = join(dir, "project");
    mkdirSync(project);
    const pkg = join(dir, "remote", "packages", "plain");
    mkdirSync(join(pkg, "src"), { recursive: true });
    // A package that ships its source as it is: a `publishConfig`, and no
    // build script.
    writeFileSync(
      join(pkg, "package.json"),
      `${JSON.stringify(
        {
          name: "plain",
          exports: { ".": "./src/index.ts" },
          publishConfig: { exports: { ".": "./dist/index.js" } },
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(join(pkg, "src", "index.ts"), "export const plain = 1;\n");
    git("init", "--quiet", "--initial-branch", "main");
    git("add", ".");
    git("commit", "--quiet", "--message", "plain");
    remote = pathToFileURL(join(dir, "remote")).href;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  const create = () =>
    Alepha.create({ env: { LOG_LEVEL: "error" } })
      .with({ provide: FileSystemProvider, use: NodeFileSystemProvider })
      .with({ provide: ShellProvider, use: NodeShellProvider });

  it("does not report a synced package with publishConfig and no build script as modified", async ({
    expect,
  }) => {
    const service = create().inject(VendorService);
    const options = {
      root: project,
      remote,
      branch: "main",
      dir: ".vendor",
      packages: ["plain"],
    };

    expect(await service.sync(options)).toEqual({
      synced: ["plain"],
      errors: [],
    });
    expect(await service.build({ ...options, packageManager: "yarn" })).toEqual(
      { built: [], skipped: ["plain"], errors: [] },
    );

    expect((await service.diff(options)).totalChanges).toBe(0);
    // So the next sync is not aborted on "local modifications".
    expect((await service.sync(options)).aborted).toBeUndefined();

    // A real edit still shows.
    writeFileSync(
      join(project, ".vendor", "plain", "src", "index.ts"),
      "export const plain = 2;\n",
    );
    const edited = await service.diff(options);
    expect(edited.packages[0].modified.map((it) => it.file)).toEqual([
      "src/index.ts",
    ]);
  });

  it("fails the sync when a configured package is not on the remote", async ({
    expect,
  }) => {
    const alepha = create();
    alepha.store.set(vendorOptions, { remote, packages: ["alpha"] });

    await expect(
      alepha
        .inject(CliProvider)
        .run(alepha.inject(TestVendorCommand).testSync, {
          root: project,
          argv: "",
        }),
    ).rejects.toThrow(/1 vendored package could not be synced/);
  });

  it("clones at a commit into its own directory even with GIT_DIR exported", async ({
    expect,
  }) => {
    // Inside a git hook, GIT_DIR names the hook's repository: `git -C <tmp>
    // init` and `remote add` used to act on it, and <tmp> stayed empty.
    const decoy = join(dir, "decoy");
    mkdirSync(decoy);
    execFileSync("git", ["init", "--quiet", decoy], { env: gitEnv() });
    const commit = git("rev-parse", "HEAD").toString().trim();
    const exported = process.env.GIT_DIR;
    process.env.GIT_DIR = join(decoy, ".git");
    let cloned: string;
    try {
      cloned = await create()
        .inject(ExposedVendorService)
        .testCloneAtCommit(remote, commit);
    } finally {
      if (exported === undefined) {
        delete process.env.GIT_DIR;
      } else {
        process.env.GIT_DIR = exported;
      }
    }

    const head = execFileSync("git", ["-C", cloned, "rev-parse", "HEAD"], {
      env: gitEnv(),
    });
    expect(head.toString().trim()).toBe(commit);
    const decoyRemotes = execFileSync("git", ["-C", decoy, "remote"], {
      env: gitEnv(),
    });
    expect(decoyRemotes.toString().trim()).toBe("");
    rmSync(cloned, { recursive: true, force: true });
  });
});

class ExposedVendorService extends VendorService {
  public testCloneAtCommit = (remote: string, commit: string) =>
    this.cloneAtCommit(remote, commit);
}
