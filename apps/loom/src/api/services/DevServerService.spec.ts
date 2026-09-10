import { Alepha } from "alepha";
import { MemoryShellProvider, ShellProvider } from "alepha/system";
import { describe, it } from "vitest";

import { DevServerService } from "./DevServerService.ts";

describe("DevServerService", () => {
  it("ties each listening port to its process's working directory", async ({
    expect,
  }) => {
    const alepha = Alepha.create().with({
      provide: ShellProvider,
      use: MemoryShellProvider,
    });
    const shell = alepha.inject(MemoryShellProvider);
    shell.outputs.set(
      "lsof -nP -iTCP -sTCP:LISTEN -F pcn",
      [
        "p100",
        "cnode",
        "f20",
        "n127.0.0.1:3312",
        "f21",
        "n[::1]:3312",
        "p200",
        "cloom",
        "f6",
        "n[::1]:27483",
      ].join("\n"),
    );
    shell.outputs.set(
      "lsof -nP -a -d cwd -p 100,200 -F pn",
      [
        "p100",
        "fcwd",
        "n/repo/.claude/worktrees/loom",
        "p200",
        "fcwd",
        "n/",
      ].join("\n"),
    );

    const servers = await alepha.inject(DevServerService).listening();

    // The IPv4 and IPv6 sockets of one port are one server.
    expect(servers).toEqual([
      {
        pid: 100,
        command: "node",
        port: 3312,
        cwd: "/repo/.claude/worktrees/loom",
      },
      { pid: 200, command: "loom", port: 27483, cwd: "/" },
    ]);
  });
});
