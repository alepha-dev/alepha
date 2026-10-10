import { Alepha } from "alepha";
import {
  FileSystemProvider,
  MemoryFileSystemProvider,
  MemoryShellProvider,
  ShellProvider,
} from "alepha/system";
import { describe, it } from "vitest";

import { DesktopCompileAdapter } from "../DesktopCompileAdapter.ts";

const setup = () => {
  const alepha = Alepha.create()
    .with({ provide: FileSystemProvider, use: MemoryFileSystemProvider })
    .with({ provide: ShellProvider, use: MemoryShellProvider });
  const fs = alepha.inject(MemoryFileSystemProvider);
  const shell = alepha.inject(MemoryShellProvider);
  for (const tool of ["codesign", "sips", "iconutil"])
    shell.installedCommands.add(tool);
  const adapter = new DesktopCompileAdapter({ fs, shell });
  return { fs, shell, adapter };
};

const root = "/my project";
const target = "bun-darwin-arm64";

describe("DesktopCompileAdapter.preflight", () => {
  it("answers the validated config", async ({ expect }) => {
    const { fs, adapter } = setup();
    await fs.writeFile("/my project/assets/icon.png", "png");
    const config = {
      name: "Loom App",
      identifier: "dev.alepha.loom",
      icon: "assets/icon.png",
      window: { width: 1280, height: 860 },
    };
    expect(await adapter.preflight({ root, config, target })).toEqual(config);
  });

  it("names every invalid field", async ({ expect }) => {
    const { adapter } = setup();
    await expect(
      adapter.preflight({
        root,
        config: { name: "../x", identifier: "loom" },
        target,
      }),
    ).rejects.toThrow(
      /desktop\.name: .*desktop\.identifier: must be reverse-DNS/,
    );
    await expect(
      adapter.preflight({
        root,
        config: { name: "A", identifier: "a.b", window: { width: -1 } },
        target,
      }),
    ).rejects.toThrow(/desktop\.window\.width/);
    await expect(
      adapter.preflight({ root, config: { name: "A" }, target }),
    ).rejects.toThrow(/desktop\.identifier/);
  });

  it("refuses an icon outside the project, not a PNG, or missing", async ({
    expect,
  }) => {
    const { adapter } = setup();
    const base = { name: "A", identifier: "a.b" };
    await expect(
      adapter.preflight({
        root,
        config: { ...base, icon: "/etc/icon.png" },
        target,
      }),
    ).rejects.toThrow("inside the project");
    await expect(
      adapter.preflight({
        root,
        config: { ...base, icon: "../icon.png" },
        target,
      }),
    ).rejects.toThrow("inside the project");
    await expect(
      adapter.preflight({
        root,
        config: { ...base, icon: "icon.jpg" },
        target,
      }),
    ).rejects.toThrow("must be a PNG");
    await expect(
      adapter.preflight({
        root,
        config: { ...base, icon: "icon.png" },
        target,
      }),
    ).rejects.toThrow("does not exist");
  });

  it("names the missing macOS tools", async ({ expect }) => {
    const { shell, adapter } = setup();
    shell.installedCommands.delete("iconutil");
    shell.installedCommands.delete("codesign");
    await expect(
      adapter.preflight({
        root,
        config: { name: "A", identifier: "a.b" },
        target,
      }),
    ).rejects.toThrow("needs codesign, iconutil");
  });
});

describe("DesktopCompileAdapter.writeEntries", () => {
  it("writes the shell, supervisor and Worker entries importing this package by absolute path", async ({
    expect,
  }) => {
    const { fs, adapter } = setup();
    const config = { name: "Loom", identifier: "dev.alepha.loom" };

    const entries = await adapter.writeEntries({ dist: "/s/dist", config });

    expect(entries).toEqual([
      "desktop-shell.js",
      "desktop-supervisor.js",
      "desktop-worker.js",
    ]);
    const shell = fs.files.get("/s/dist/desktop-shell.js")!.toString();
    expect(shell).toMatch(
      /import \{ DesktopMain \} from "\/.+\/src\/shell\/index\.ts";/,
    );
    expect(shell).toContain(`config: ${JSON.stringify(config)}`);
    expect(shell).toContain(
      'workerUrl: new URL("./desktop-worker.js", import.meta.url).href',
    );
    expect(shell).toContain(
      'supervisorUrl: new URL("./desktop-supervisor.js", import.meta.url).href',
    );

    const supervisor = fs.files
      .get("/s/dist/desktop-supervisor.js")!
      .toString();
    expect(supervisor).toContain(
      "new DesktopSupervisorWorker(self, (handle) => terminator.terminate(handle)).listen();",
    );

    const worker = fs.files.get("/s/dist/desktop-worker.js")!.toString();
    expect(worker).toMatch(
      /import \{ DesktopWorkerHost \} from "\/.+\/src\/worker\/index\.ts";/,
    );
    expect(worker).toContain(
      'new DesktopWorkerHost(self, () => import("./index.bun.js")).listen();',
    );
  });
});
