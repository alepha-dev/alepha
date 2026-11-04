import { Alepha } from "alepha";
import { describe, it } from "vitest";

import { AlephaDesktopShell, DesktopPaths } from "../index.ts";

describe("DesktopPaths", () => {
  it("derives resources from the executable inside a bundle, not from the working directory", ({
    expect,
  }) => {
    const paths = Alepha.create().with(AlephaDesktopShell).inject(DesktopPaths);

    paths.execPath = "/Applications/My App.app/Contents/MacOS/myapp";
    expect(paths.resourcesDir()).toBe(
      "/Applications/My App.app/Contents/Resources",
    );

    paths.execPath = "/opt/bin/myapp";
    expect(paths.resourcesDir()).toBe("/opt/bin");
  });

  it("puts data and logs in per-user folders named by identifier", ({
    expect,
  }) => {
    const paths = Alepha.create().with(AlephaDesktopShell).inject(DesktopPaths);
    paths.home = "/Users/a";

    expect(paths.dataDir("dev.alepha.notepad")).toBe(
      "/Users/a/Library/Application Support/dev.alepha.notepad",
    );
    expect(paths.logFile("dev.alepha.notepad")).toBe(
      "/Users/a/Library/Logs/dev.alepha.notepad/app.log",
    );
    expect(paths.lockFile("dev.alepha.notepad")).toBe(
      "/Users/a/Library/Application Support/dev.alepha.notepad/instance.lock",
    );
  });
});
