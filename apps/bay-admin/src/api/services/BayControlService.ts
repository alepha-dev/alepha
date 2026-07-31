import { request } from "node:http";
import { $env, AlephaError, type FileLike, z } from "alepha";
import { $logger } from "alepha/logger";

/**
 * One app instance as bay-go reports it.
 */
export interface BayApp {
  name: string;
  env: string;
  domain: string;
  release: string;
  port: number;
  runtime: string;
  /**
   * Whether the app is answering right now, asked of the supervisor per call.
   *
   * Distinct from being registered: a stopped or crashed app stays in the list,
   * and without this the two are indistinguishable.
   */
  running?: boolean;
  /**
   * What the supervisor is spending on this app right now.
   *
   * Absent when it has nothing to say — an unsupervised child process, an app
   * that is not running. A snapshot with no history: keeping a series belongs
   * here, in bay-admin, not in the orchestrator that loses it on every upgrade.
   */
  usage?: BayAppUsage;
  controlApi?: boolean;
  backups?: boolean;
  lastBackupAt?: string;
  lastBackupError?: string;
}

/**
 * A live reading of what one app costs, as bay-go's supervisor reports it.
 */
export interface BayAppUsage {
  memoryBytes?: number;
  cpuSeconds?: number;
  tasks?: number;
  /**
   * Automatic restarts since the unit was last started by hand. The most
   * useful number here: an app quietly crash-looping looks perfectly healthy
   * from the outside.
   */
  restarts: number;
  startedAt?: string;
  pid?: number;
}

/**
 * What bay-go answers after a deploy.
 */
export interface BayDeployResult {
  release: string;
  url: string;
  sleepEligible: boolean;
  restore: Record<string, unknown>;
}

/**
 * Server-side client for bay-go's control API.
 *
 * **Reached over a unix socket, and holds no secret.** The control API is
 * root-equivalent — it deploys code, reads secrets, can delete every backup — so
 * the question is not how to protect a token but how to avoid having one. On the
 * socket the authorization is the file mode, arbitrated by the kernel: pulse can
 * connect because an operator put its unix user in the control group, and there
 * is no string that could leak from this process, its logs, or its backups.
 *
 * Uses `node:http` rather than the framework's `HttpClient` because `fetch` has
 * no way to dial a unix socket — undici can, but only through a dispatcher that
 * `HttpClient` does not expose. `socketPath` is the standard answer and this
 * service is server-only, so nothing is lost.
 */
export class BayControlService {
  protected readonly log = $logger();

  protected readonly env = $env(
    z.object({
      /**
       * Path to bay-go's control socket.
       */
      BAY_SOCKET: z.text({
        default: "/run/bay/control.sock",
        description:
          "Unix socket of the bay-go control API. Reachable only by members of the control group — pulse holds no token.",
      }),
    }),
  );

  /**
   * Reports whether the control socket is there to be talked to.
   *
   * Distinguished from a failed call on purpose: "Bay is not reachable from
   * here" and "Bay refused what you asked" call for different reactions, and
   * collapsing them hides which one it is. Checked by connecting rather than by
   * stat-ing, because a socket that exists but rejects us — wrong group — looks
   * identical on disk to one that works.
   */
  async reachable(): Promise<boolean> {
    try {
      await this.call("GET", "/apps");
      return true;
    } catch {
      return false;
    }
  }

  async listApps(): Promise<BayApp[]> {
    const res = await this.call<BayApp[]>("GET", "/apps");
    // bay-go serialises an empty registry as `null`, not `[]`.
    return res ?? [];
  }

  /**
   * Uploads an artifact and deploys it.
   *
   * The bytes are read out explicitly: `z.file()` hands the handler a `FileLike`
   * — a plain object with `stream()` / `arrayBuffer()`, NOT a native `Blob` — and
   * passing it straight to a request body serialises it as `[object Object]`,
   * which Bay then rejects as `not a gzip archive`, blaming an artifact that was
   * fine.
   */
  async deploy(args: {
    file: FileLike;
    name: string;
    env: string;
    domain?: string;
  }): Promise<BayDeployResult> {
    const query = new URLSearchParams({ name: args.name, env: args.env });
    if (args.domain) {
      query.set("domain", args.domain);
    }
    // Deliberately never passes `allowControlApi`. Granting an app
    // root-equivalent access is an operator act, and pulse has no per-user
    // permission model for it yet — so it does not offer it at all rather than
    // offer it to everyone who can log in.
    const bytes = Buffer.from(await args.file.arrayBuffer());
    return await this.call<BayDeployResult>(
      "POST",
      `/apps?${query.toString()}`,
      bytes,
    );
  }

  async stop(name: string, env: string): Promise<void> {
    await this.call("POST", `/apps/${name}/${env}/stop`);
  }

  /**
   * Unregisters an app. Never purges: see the controller for why.
   */
  async remove(name: string, env: string): Promise<Record<string, unknown>> {
    return await this.call("DELETE", `/apps/${name}/${env}`);
  }

  async backup(name: string, env: string): Promise<Record<string, unknown>> {
    return await this.call("POST", `/apps/${name}/${env}/backup`);
  }

  async releases(name: string, env: string): Promise<unknown> {
    return await this.call("GET", `/apps/${name}/${env}/releases`);
  }

  async rollback(
    name: string,
    env: string,
    to?: string,
    confirm?: boolean,
  ): Promise<unknown> {
    const query = new URLSearchParams();
    if (to) {
      query.set("to", to);
    }
    if (confirm) {
      query.set("confirm", "yes");
    }
    const suffix = query.toString() ? `?${query.toString()}` : "";
    return await this.call("POST", `/apps/${name}/${env}/rollback${suffix}`);
  }

  /**
   * Performs one control-API call over the socket.
   *
   * bay-go answers errors in Alepha's own shape, so `message` is the sentence it
   * wrote for an operator — "rebuild with `alepha build --target=bare`",
   * "redeploy the app to migrate it". Surfaced as-is: replacing it with a generic
   * failure throws away the only part that says what to do.
   */
  protected call<T>(method: string, path: string, body?: Buffer): Promise<T> {
    const socketPath = this.env.BAY_SOCKET;
    return new Promise<T>((resolve, reject) => {
      const req = request(
        {
          socketPath,
          path,
          method,
          headers: body
            ? {
                "content-type": "application/octet-stream",
                "content-length": body.length,
              }
            : {},
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const raw = Buffer.concat(chunks).toString("utf8");
            let parsed: any;
            try {
              parsed = raw ? JSON.parse(raw) : undefined;
            } catch {
              reject(
                new AlephaError(
                  `Bay answered ${res.statusCode} with a body that is not JSON: ${raw.slice(0, 200)}`,
                ),
              );
              return;
            }
            if ((res.statusCode ?? 500) >= 400) {
              // Bay ANSWERED — it just said no. Kept distinct from a transport
              // failure below: relabelling a 400 as "unreachable" sends the
              // reader to check the socket when the real problem is the artifact
              // they uploaded.
              this.log.warn("bay refused the request", {
                path,
                status: res.statusCode,
                reason: parsed?.message,
              });
              reject(
                new AlephaError(
                  `Bay refused the request: ${parsed?.message ?? res.statusCode}`,
                ),
              );
              return;
            }
            resolve(parsed as T);
          });
        },
      );
      req.on("error", (error) => {
        // Only a genuine transport failure reaches here: the socket is absent,
        // or this process is not in the control group. Name the path — the
        // alternative is "ECONNREFUSED" with nothing to act on.
        this.log.error("bay control socket unreachable", { socketPath, error });
        reject(
          new AlephaError(
            `Bay control socket unreachable at ${socketPath}. Is bay running, and is this app in the control group (deploy it with \`--allow-control-api\`)?`,
          ),
        );
      });
      if (body) {
        req.write(body);
      }
      req.end();
    });
  }
}
