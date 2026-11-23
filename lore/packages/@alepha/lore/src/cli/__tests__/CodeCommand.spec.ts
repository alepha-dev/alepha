import { Alepha } from "alepha";
import {
  CliProvider,
  ConsoleOutputProvider,
  MemoryOutputProvider,
} from "alepha/command";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, it } from "vitest";

import { CodeCommand } from "../commands/CodeCommand.ts";
import { LoreProjectResolver } from "../services/LoreProjectResolver.ts";

/**
 * `lore code`, `lore clone` and `lore git-credential` (#Q3934): the helper
 * answers git with the CLI's own credential, is installed behind an empty
 * entry so no keychain stores it, and `clone` resolves the URL Lore gives.
 */
class StdinCodeCommand extends CodeCommand {
  public stdin = "";

  protected override async readStdin(): Promise<string> {
    return this.stdin;
  }
}

const REPO = {
  id: "01900000-0000-7000-8000-000000000001",
  projectId: 7,
  slug: "hello",
  defaultBranch: "main",
  cloneUrl: "https://lore.test/hello.git",
  createdAt: "2026-11-19T10:00:00.000Z",
};

describe("lore code", () => {
  const create = (env: Record<string, string> = {}) => {
    const alepha = Alepha.create({
      env: {
        LOG_LEVEL: "error",
        LORE_API_KEY: "ak_test",
        LORE_URL: "https://lore.test",
        LORE_PROJECT: "hello",
        HOME: "/nonexistent",
        ...env,
      },
    })
      .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
      .with({ provide: ShellProvider, use: MemoryShellProvider })
      .with({ provide: ConsoleOutputProvider, use: MemoryOutputProvider });
    const printed = alepha.inject(MemoryOutputProvider).lines;
    const shell = alepha.inject(MemoryShellProvider);
    const command = alepha.inject(StdinCodeCommand);
    const sent: Array<[string, unknown]> = [];
    Object.assign(
      alepha.inject(LoreProjectResolver) as unknown as Record<string, unknown>,
      { projects: { getProjectBySlug: async () => ({ id: 7 }) } },
    );
    const repositories = [REPO];
    Object.assign(command as unknown as Record<string, unknown>, {
      api: {
        listCodeRepositories: async (request: unknown) => {
          sent.push(["list", request]);
          return { repositories };
        },
        createCodeRepository: async (request: any) => {
          sent.push(["create", request]);
          return { ...REPO, slug: request.body.slug };
        },
        deleteCodeRepository: async (request: unknown) => {
          sent.push(["delete", request]);
          return { ok: true };
        },
      },
    });
    const run = (cmd: any, argv: string, root = "/work") =>
      alepha.inject(CliProvider).run(cmd, { argv, root });
    return { run, printed, shell, command, sent, repositories };
  };

  it("answers git's get with LORE_API_KEY, and store or erase with nothing", async ({
    expect,
  }) => {
    const { run, printed, command } = create();
    command.stdin = "protocol=https\nhost=lore.test\n\n";

    await run(command.gitCredential, "get");
    await run(command.gitCredential, "store");
    await run(command.gitCredential, "erase");

    expect(printed).toEqual(["username=lore\npassword=ak_test"]);
  });

  it("answers nothing for a host it holds no credential for", async ({
    expect,
  }) => {
    const { run, printed, command } = create({
      LORE_API_KEY: "",
      LORE_URL: "",
    });
    command.stdin = "protocol=https\nhost=elsewhere.test\n\n";

    await run(command.gitCredential, "get");

    expect(printed).toEqual([]);
  });

  it("clones the URL Lore gives, after installing the helper behind an empty entry", async ({
    expect,
  }) => {
    const { run, shell, command } = create();

    await run(command.clone, "hello my-dir");

    const commands = shell.calls.map((call) => call.argv ?? [call.command]);
    const key = "credential.https://lore.test.helper";
    expect(commands[0]).toEqual([
      "git",
      "config",
      "--global",
      "--unset-all",
      key,
    ]);
    expect(commands[1]).toEqual([
      "git",
      "config",
      "--global",
      "--add",
      key,
      "",
    ]);
    expect(commands[2]?.slice(0, 5)).toEqual([
      "git",
      "config",
      "--global",
      "--add",
      key,
    ]);
    expect(commands[2]?.[5]).toMatch(/^!.* git-credential$/);
    expect(commands[3]).toEqual([
      "git",
      "clone",
      "https://lore.test/hello.git",
      "my-dir",
    ]);
  });

  it("names the repositories when a project holds several and none is named", async ({
    expect,
  }) => {
    const { run, command, repositories } = create();
    repositories.push({ ...REPO, slug: "web" }, { ...REPO, slug: "api" });
    repositories.shift();

    await expect(run(command.clone, "hello")).rejects.toThrow(/web, api/);
  });

  it("creates, lists and deletes through the API the code_repo tools call", async ({
    expect,
  }) => {
    const { run, printed, command, sent } = create();

    await run(command.create, "docs --default-branch trunk");
    await run(command.list, "");
    await run(command.delete, "docs");

    expect(sent).toEqual([
      [
        "create",
        {
          params: { projectId: 7 },
          body: { slug: "docs", defaultBranch: "trunk" },
        },
      ],
      ["list", { params: { projectId: 7 } }],
      ["delete", { params: { projectId: 7, slug: "docs" } }],
    ]);
    expect(printed.join("\n")).toContain("hello  https://lore.test/hello.git");
  });

  it("prints a checkout's Lore URL, or adds it as a remote with --add", async ({
    expect,
  }) => {
    const { run, printed, shell, command } = create();

    await run(command.remote, "");
    await run(command.remote, "--add --name origin");

    expect(printed[0]).toBe("https://lore.test/hello.git");
    expect(
      shell.calls.some(
        (call) =>
          call.argv?.join(" ") ===
          "git remote add origin https://lore.test/hello.git",
      ),
    ).toBe(true);
  });

  it("reads the repository this checkout's Lore remote names, and prints a file numbered (#Q4139)", async ({
    expect,
  }) => {
    const { run, printed, shell, command } = create({ LORE_PROJECT: "" });
    shell.outputs.set(
      "git remote -v",
      [
        "origin\thttps://github.com/acme/elsewhere.git (fetch)",
        "lore\thttps://lore.test/acme/api.git (fetch)",
      ].join("\n"),
    );
    const asked: unknown[] = [];
    Object.assign(command as unknown as Record<string, unknown>, {
      api: {
        listCodeRepositories: async () => ({
          repositories: [{ ...REPO, slug: "api" }],
        }),
      },
      browser: {
        getCodeFile: async (request: unknown) => {
          asked.push(request);
          return {
            revision: { name: "main", kind: "branch", sha: "a".repeat(40) },
            path: "src/a.ts",
            sha: "b".repeat(40),
            size: 4,
            status: "ok",
            text: "one\ntwo\n",
          };
        },
      },
    });

    await run(command.cat, "src/a.ts --end-line 1");

    expect(asked).toEqual([
      {
        params: { projectId: 7, slug: "api" },
        query: { ref: undefined, path: "src/a.ts" },
      },
    ]);
    expect(printed).toEqual(["1\tone", "... 1 more lines: --start-line 2"]);
  });
});
