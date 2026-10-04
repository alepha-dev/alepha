import { Alepha } from "alepha";
import { MemoryShellProvider, ShellProvider } from "alepha/system";
import { describe, it } from "vitest";

import { EditorLauncher } from "../server/services/EditorLauncher.ts";

/**
 * Records what would be spawned instead of spawning it.
 */
class TestEditorLauncher extends EditorLauncher {
  public launched: Array<[string, string[]]> = [];

  protected override launch(command: string, args: string[]): void {
    this.launched.push([command, args]);
  }
}

const setup = (env: Record<string, string>, installed: string[] = []) => {
  // Blank by default: the developer's own EDITOR must not decide the spec.
  const alepha = Alepha.create({
    env: { LAUNCH_EDITOR: "", EDITOR: "", ...env },
  })
    .with({ provide: ShellProvider, use: MemoryShellProvider })
    .with({ provide: EditorLauncher, use: TestEditorLauncher });
  alepha
    .inject(MemoryShellProvider)
    .configure({ installedCommands: installed });
  return alepha.inject(TestEditorLauncher);
};

describe("EditorLauncher", () => {
  it("calls LAUNCH_EDITOR with the file, the line and the column", async ({
    expect,
  }) => {
    const launcher = setup({ LAUNCH_EDITOR: "my-open", EDITOR: "code" });

    await launcher.open("/app/src/a.ts", 12, 3);

    expect(launcher.launched).toEqual([
      ["my-open", ["/app/src/a.ts", "12", "3"]],
    ]);
  });

  it("speaks each editor's line syntax", async ({ expect }) => {
    const cases: Array<[string, string[]]> = [
      ["code", ["-g", "/a.ts:7:2"]],
      ["cursor", ["-g", "/a.ts:7:2"]],
      ["zed", ["/a.ts:7:2"]],
      ["webstorm", ["--line", "7", "--column", "2", "/a.ts"]],
      ["/usr/local/bin/subl", ["/a.ts:7:2"]],
      ["code --wait", ["--wait", "-g", "/a.ts:7:2"]],
    ];
    for (const [editor, args] of cases) {
      const launcher = setup({ EDITOR: editor });
      await launcher.open("/a.ts", 7, 2);
      expect(launcher.launched[0]?.[1]).toEqual(args);
    }
  });

  it("refuses a terminal editor, which has no terminal to show in", async ({
    expect,
  }) => {
    const launcher = setup({ EDITOR: "nvim" });

    await expect(launcher.open("/a.ts", 1)).rejects.toThrow(/terminal editor/);
    expect(launcher.launched).toEqual([]);
  });

  it("uses code when installed and nothing is set, and says what to set otherwise", async ({
    expect,
  }) => {
    const withCode = setup({}, ["code"]);
    await withCode.open("/a.ts", 1);
    expect(withCode.launched[0]?.[0]).toBe("code");

    await expect(setup({}).open("/a.ts", 1)).rejects.toThrow(/set EDITOR/);
  });
});
