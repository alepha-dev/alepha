import { $inject } from "alepha";
import { DateTimeProvider } from "alepha/datetime";
import { ShellProvider } from "alepha/system";

import type { DevServer } from "../schemas/devServerSchema.ts";

/**
 * Listening TCP sockets and the working directory of the process behind
 * each, which is how a dev server is tied to the worktree it was started in.
 *
 * Two `lsof` calls answer every worktree of every project at once, cached for
 * {@link ttl}: one for the listening sockets, one for those processes' `cwd`.
 */
export class DevServerService {
  protected readonly shell = $inject(ShellProvider);
  protected readonly dateTime = $inject(DateTimeProvider);

  protected readonly ttl = 4_000;
  protected cache?: { at: number; servers: DevServer[] };

  public async listening(): Promise<DevServer[]> {
    const now = this.dateTime.nowMillis();
    if (this.cache && now - this.cache.at < this.ttl) {
      return this.cache.servers;
    }

    const sockets = this.parseSockets(
      await this.lsof(["-nP", "-iTCP", "-sTCP:LISTEN", "-F", "pcn"]),
    );
    const pids = [...new Set(sockets.map((socket) => socket.pid))];
    const cwds =
      pids.length === 0
        ? new Map<number, string>()
        : this.parseCwds(
            await this.lsof([
              "-nP",
              "-a",
              "-d",
              "cwd",
              "-p",
              pids.join(","),
              "-F",
              "pn",
            ]),
          );

    const servers: DevServer[] = [];
    for (const socket of sockets) {
      const cwd = cwds.get(socket.pid);
      if (cwd) {
        servers.push({ ...socket, cwd });
      }
    }
    this.cache = { at: now, servers };
    return servers;
  }

  /**
   * `-F pcn` output: `p<pid>`, `c<command>`, then one `n<address:port>` per
   * socket. A port listened on over IPv4 and IPv6 is one server.
   */
  public parseSockets(
    output: string,
  ): Array<{ pid: number; command: string; port: number }> {
    const sockets: Array<{ pid: number; command: string; port: number }> = [];
    const seen = new Set<string>();
    let pid = 0;
    let command = "";
    for (const line of output.split("\n")) {
      if (line.startsWith("p")) {
        pid = Number(line.slice(1));
      } else if (line.startsWith("c")) {
        command = line.slice(1);
      } else if (line.startsWith("n")) {
        const port = Number(/:(\d+)$/.exec(line)?.[1]);
        const key = `${pid}:${port}`;
        if (pid && port && !seen.has(key)) {
          seen.add(key);
          sockets.push({ pid, command, port });
        }
      }
    }
    return sockets;
  }

  /**
   * `-F pn` output restricted to `cwd` descriptors: `p<pid>` then `n<path>`.
   */
  public parseCwds(output: string): Map<number, string> {
    const cwds = new Map<number, string>();
    let pid = 0;
    for (const line of output.split("\n")) {
      if (line.startsWith("p")) {
        pid = Number(line.slice(1));
      } else if (line.startsWith("n") && pid) {
        cwds.set(pid, line.slice(1));
      }
    }
    return cwds;
  }

  protected async lsof(args: string[]): Promise<string> {
    const result = await this.shell
      .capture(["lsof", ...args], { timeout: 5_000 })
      .catch(() => ({ stdout: "", stderr: "", exitCode: -1 }));
    // `lsof` exits 1 when one of the pids vanished between the two calls; the
    // rest of its output is still right.
    return result.stdout;
  }
}
