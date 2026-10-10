import { Alepha } from "alepha";
import { MemoryFileSystemProvider } from "alepha/system";
import { describe, it } from "vitest";

import {
  AlephaDesktopShell,
  DesktopPaths,
  DesktopShell,
  InstanceLockProvider,
  MemoryInstanceLockProvider,
  MemorySupervisorProvider,
  MemoryWindowProvider,
  SupervisorProvider,
  WindowProvider,
} from "../index.ts";

const config = { name: "Fixture", identifier: "dev.alepha.fixture" };

const setup = () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "silent" } }).with(
    AlephaDesktopShell,
  );
  const window = alepha.inject(WindowProvider) as MemoryWindowProvider;
  const supervisor = alepha.inject(
    SupervisorProvider,
  ) as MemorySupervisorProvider;
  const lock = alepha.inject(
    InstanceLockProvider,
  ) as MemoryInstanceLockProvider;
  const paths = alepha.inject(DesktopPaths);
  paths.home = "/Users/test";
  supervisor.window = window;
  const shell = alepha.inject(DesktopShell);
  const fs = alepha.inject(MemoryFileSystemProvider);
  return { alepha, window, supervisor, lock, shell, fs };
};

describe("DesktopShell", () => {
  it("binds memory providers in tests", ({ expect }) => {
    const { window, supervisor, lock } = setup();
    expect(window).toBeInstanceOf(MemoryWindowProvider);
    expect(supervisor).toBeInstanceOf(MemorySupervisorProvider);
    expect(lock).toBeInstanceOf(MemoryInstanceLockProvider);
  });

  it("opens one window after readiness, loads the bootstrap URL, and exits 0 after a graceful stop", async ({
    expect,
  }) => {
    const { window, supervisor, lock, shell, fs } = setup();

    const exit = shell.run({
      config,
      workerUrl: "file:///worker.js",
      env: { SERVER_HOST: "0.0.0.0", FOO: "bar" },
    });
    await window.waitForRun();

    expect(
      fs.directories.has(
        "/Users/test/Library/Application Support/dev.alepha.fixture",
      ),
    ).toBe(true);
    expect(
      fs.directories.has("/Users/test/Library/Logs/dev.alepha.fixture"),
    ).toBe(true);
    expect(lock.acquired).toBe(
      "/Users/test/Library/Application Support/dev.alepha.fixture/instance.lock",
    );
    expect(supervisor.workerUrl).toBe("file:///worker.js");
    expect(supervisor.init?.env).toEqual({
      NODE_ENV: "production",
      FOO: "bar",
      SERVER_HOST: "127.0.0.1",
      SERVER_PORT: "0",
    });
    expect(supervisor.init?.capability).toMatch(/^[0-9a-f]{64}$/);
    expect(window.opened).toEqual({
      appName: "Fixture",
      title: "Fixture",
      width: 1200,
      height: 800,
      resizable: true,
    });
    expect(supervisor.handle).toBe(window.handle());
    expect(window.navigations).toEqual([
      `http://127.0.0.1:43210/__alepha_desktop/bootstrap?capability=${supervisor.init?.capability}`,
    ]);
    expect(supervisor.stopped).toBe(false);

    window.close();
    expect(await exit).toBe(0);
    expect(supervisor.stopped).toBe(true);
    expect(window.destroyed).toBe(true);
    expect(lock.released).toBe(true);
    expect(window.alerts).toEqual([]);
  });

  it("uses a fresh capability per launch", async ({ expect }) => {
    const capabilities = new Set<string>();
    for (let i = 0; i < 2; i++) {
      const { window, supervisor, shell } = setup();
      const exit = shell.run({ config, workerUrl: "w" });
      await window.waitForRun();
      capabilities.add(supervisor.init!.capability);
      window.close();
      await exit;
    }
    expect(capabilities.size).toBe(2);
  });

  it("applies the window options", async ({ expect }) => {
    const { window, shell } = setup();
    const exit = shell.run({
      config: {
        ...config,
        window: { title: "Hello", width: 640, height: 480, resizable: false },
      },
      workerUrl: "w",
    });
    await window.waitForRun();
    expect(window.opened).toEqual({
      appName: "Fixture",
      title: "Hello",
      width: 640,
      height: 480,
      resizable: false,
    });
    window.close();
    await exit;
  });

  it("refuses a second instance before starting anything", async ({
    expect,
  }) => {
    const { window, supervisor, lock, shell } = setup();
    lock.held.add(
      "/Users/test/Library/Application Support/dev.alepha.fixture/instance.lock",
    );

    expect(await shell.run({ config, workerUrl: "w" })).toBe(4);
    expect(supervisor.init).toBeUndefined();
    expect(window.opened).toBeUndefined();
    expect(window.alerts).toEqual([
      {
        title: "Fixture is already running",
        message:
          "Another Fixture window is open. Switch to it, or quit it before opening Fixture again.",
      },
    ]);
  });

  it("shows a startup failure with the log path and exits 1 without a window", async ({
    expect,
  }) => {
    const { window, supervisor, lock, shell } = setup();
    supervisor.startResult = { ok: false, message: "injected startup failure" };

    expect(await shell.run({ config, workerUrl: "w" })).toBe(1);
    expect(window.opened).toBeUndefined();
    expect(lock.released).toBe(true);
    expect(window.alerts).toEqual([
      {
        title: "Fixture could not start",
        message:
          "injected startup failure\n\nDetails are in /Users/test/Library/Logs/dev.alepha.fixture/app.log",
      },
    ]);
  });

  it("shows a crash that ended the window loop and exits 2", async ({
    expect,
  }) => {
    const { window, supervisor, shell } = setup();

    const exit = shell.run({ config, workerUrl: "w" });
    await window.waitForRun();
    supervisor.crash("the server Worker exited (code 9)");

    expect(await exit).toBe(2);
    expect(window.alerts[0].title).toBe("Fixture stopped unexpectedly");
    expect(window.alerts[0].message).toContain(
      "the server Worker exited (code 9)",
    );
  });

  it("exits 3 when the stop is not graceful", async ({ expect }) => {
    const { window, supervisor, shell } = setup();
    supervisor.stopResult = {
      kind: "stopped",
      graceful: false,
      message: "timed out",
    };

    const exit = shell.run({ config, workerUrl: "w" });
    await window.waitForRun();
    window.close();

    expect(await exit).toBe(3);
  });

  it("exits 5 and stops the server when the window cannot open", async ({
    expect,
  }) => {
    const { window, supervisor, shell } = setup();
    window.failOpen = new Error("dlopen failed: libwebview.dylib");

    expect(await shell.run({ config, workerUrl: "w" })).toBe(5);
    expect(supervisor.stopped).toBe(true);
    expect(window.alerts[0].title).toBe("Fixture could not open its window");
    expect(window.alerts[0].message).toContain(
      "dlopen failed: libwebview.dylib",
    );
  });

  it("refuses an invalid config before touching anything", async ({
    expect,
  }) => {
    const { supervisor, lock, shell } = setup();

    await expect(
      shell.run({
        config: { name: "../evil", identifier: "dev.alepha.x" },
        workerUrl: "w",
      }),
    ).rejects.toThrow();
    await expect(
      shell.run({
        config: { name: "Ok", identifier: "not-reverse-dns" },
        workerUrl: "w",
      }),
    ).rejects.toThrow();
    await expect(
      shell.run({
        config: { ...config, window: { width: 0 } },
        workerUrl: "w",
      }),
    ).rejects.toThrow();
    expect(lock.acquired).toBeUndefined();
    expect(supervisor.init).toBeUndefined();
  });
});
