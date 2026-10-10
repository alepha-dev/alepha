import { Alepha } from "alepha";
import { MemoryFileSystemProvider } from "alepha/system";
import { describe, it } from "vitest";

import {
  AlephaDesktopShell,
  DesktopLogs,
  LogFileProvider,
  MemoryLogFileProvider,
} from "../index.ts";

const file = "/Users/a/Library/Logs/dev.alepha.x/app.log";

const setup = () => {
  const alepha = Alepha.create({ env: { LOG_LEVEL: "silent" } }).with(
    AlephaDesktopShell,
  );
  const logs = alepha.inject(DesktopLogs);
  logs.maxBytes = 10;
  return {
    logs,
    fs: alepha.inject(MemoryFileSystemProvider),
    files: alepha.inject(LogFileProvider) as MemoryLogFileProvider,
  };
};

describe("DesktopLogs", () => {
  it("defaults to rotating at 10 MiB", ({ expect }) => {
    const alepha = Alepha.create().with(AlephaDesktopShell);
    expect(alepha.inject(DesktopLogs).maxBytes).toBe(10 * 1024 * 1024);
  });

  it("redirects output to the file, leaving a small file in place", async ({
    expect,
  }) => {
    const { logs, fs, files } = setup();
    await fs.writeFile(file, "short");

    expect(await logs.open(file)).toBe(true);

    expect(files.redirects).toEqual([file]);
    expect(fs.files.get(file)?.toString()).toBe("short");
    expect(fs.files.has(`${file}.1`)).toBe(false);
  });

  it("rotates a full file into the one backup, replacing the previous backup", async ({
    expect,
  }) => {
    const { logs, fs, files } = setup();
    await fs.writeFile(`${file}.1`, "oldest");
    await fs.writeFile(file, "0123456789-full");

    await logs.rotate(file);

    expect(fs.files.get(`${file}.1`)?.toString()).toBe("0123456789-full");
    expect(fs.files.has(file)).toBe(false);
    expect(files.redirects).toEqual([file]);
  });

  it("does not reopen when nothing rotated", async ({ expect }) => {
    const { logs, fs, files } = setup();
    await fs.writeFile(file, "small");
    await logs.rotate(file);
    expect(files.redirects).toEqual([]);
  });

  it("never fails the app when the file cannot be written", async ({
    expect,
  }) => {
    const { logs, files } = setup();
    files.failure = new Error("EACCES");
    const original = console.error;
    console.error = () => {};
    try {
      expect(await logs.open(file)).toBe(false);
      await expect(logs.rotate(file)).resolves.toBeUndefined();
    } finally {
      console.error = original;
    }
  });
});
