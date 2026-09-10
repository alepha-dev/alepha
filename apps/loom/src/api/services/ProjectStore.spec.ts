import { Alepha } from "alepha";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, it } from "vitest";

import { ProjectStore } from "./ProjectStore.ts";

const setup = () => {
  const alepha = Alepha.create({ env: { HOME: "/home/me" } })
    .with({ provide: ShellProvider, use: MemoryShellProvider })
    .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider });
  return {
    store: alepha.inject(ProjectStore),
    shell: alepha.inject(MemoryShellProvider),
    fs: alepha.inject(MemoryFileSystemProvider),
  };
};

describe("ProjectStore", () => {
  it("stores a repository at its top level, under ~/.alepha/apps/loom", async ({
    expect,
  }) => {
    const { store, shell, fs } = setup();
    shell.outputs.set("git rev-parse --show-toplevel", "/home/me/git/alepha\n");

    const project = await store.add({ path: "~/git/alepha/apps/loom" });

    expect(project).toEqual({
      id: "alepha",
      name: "alepha",
      path: "/home/me/git/alepha",
    });
    expect(shell.calls[0].options.root).toBe("/home/me/git/alepha/apps/loom");
    expect(
      fs.wasWrittenMatching(
        "/home/me/.alepha/apps/loom/projects.json",
        /"path": "\/home\/me\/git\/alepha"/,
      ),
    ).toBe(true);
    expect(await store.list()).toEqual([project]);
  });

  it("refuses a directory outside any repository", async ({ expect }) => {
    const { store, shell } = setup();
    shell.errors.set("git rev-parse --show-toplevel", "not a git repository");

    await expect(store.add({ path: "/tmp" })).rejects.toThrow(
      /not inside a git repository/,
    );
  });

  it("refuses the same repository twice, and a relative path", async ({
    expect,
  }) => {
    const { store, shell } = setup();
    shell.outputs.set("git rev-parse --show-toplevel", "/home/me/git/club\n");
    await store.add({ path: "/home/me/git/club" });

    await expect(store.add({ path: "/home/me/git/club/apps" })).rejects.toThrow(
      /already open as 'club'/,
    );
    await expect(store.add({ path: "git/club" })).rejects.toThrow(
      /not an absolute path/,
    );
  });

  it("gives a second project with the same name its own id", async ({
    expect,
  }) => {
    const { store, shell } = setup();
    shell.outputs.set("git rev-parse --show-toplevel", "/a/app\n");
    const first = await store.add({ path: "/a/app" });
    shell.outputs.set("git rev-parse --show-toplevel", "/b/app\n");
    const second = await store.add({ path: "/b/app" });

    expect([first.id, second.id]).toEqual(["app", "app-2"]);

    await store.remove("app");
    expect((await store.list()).map((it) => it.id)).toEqual(["app-2"]);
  });
});
