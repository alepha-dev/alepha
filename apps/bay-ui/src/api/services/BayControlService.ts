import { $env, $inject, AlephaError, type FileLike, z } from "alepha";
import { $logger } from "alepha/logger";
import { HttpClient, HttpError } from "alepha/server";

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
 * **This is the only thing that holds `BAY_TOKEN`, and it never runs in the
 * browser.** The control API is root-equivalent — it deploys code, reads
 * secrets and can delete every backup — so the token must never be handed to a
 * client, not even to an authenticated admin's browser. bay-ui therefore
 * re-exposes only the operations it wants, behind its own `$action`s and its
 * own authorization.
 *
 * The API listens on loopback. In phase 1 bay-ui runs in dev on the developer's
 * machine and reaches it through an SSH tunnel
 * (`ssh -L 7717:127.0.0.1:7717 ovh-bay`), which keeps the control plane off the
 * network entirely rather than exposing a port and defending it.
 */
export class BayControlService {
  protected readonly log = $logger();
  protected readonly http = $inject(HttpClient);

  protected readonly env = $env(
    z.object({
      /**
       * Base URL of bay-go's control API, e.g. `http://127.0.0.1:7717`.
       */
      BAY_URL: z.text({
        default: "http://127.0.0.1:7717",
        description:
          "Base URL of the bay-go control API. Loopback by default — reach a remote Bay through an SSH tunnel rather than exposing the port.",
      }),
      /**
       * Bearer token printed by `bay token`.
       */
      BAY_TOKEN: z.text({
        default: "",
        description:
          "Bearer token for the bay-go control API, from `bay token`. Root-equivalent: never expose it to a browser.",
      }),
    }),
  );

  /**
   * Reports whether bay-ui is configured to reach a Bay at all.
   *
   * Surfaced in the UI instead of letting every call fail with a connection
   * error: "not configured" and "Bay is down" need different reactions from
   * whoever is looking at the screen.
   */
  get configured(): boolean {
    return !!this.env.BAY_TOKEN;
  }

  async listApps(): Promise<BayApp[]> {
    const res = await this.call<BayApp[]>("GET", "/apps");
    // bay-go serialises an empty registry as `null`, not `[]`.
    return res ?? [];
  }

  /**
   * Uploads an artifact and deploys it.
   *
   * The artifact goes up as the raw request body, exactly as `bay deploy` sends
   * it — bay-go reads the body straight into a temp file, so there is no
   * multipart envelope to unwrap on its side.
   *
   * The bytes are read out explicitly. `z.file()` hands the handler a
   * `FileLike` — a plain object with `name` / `type` / `size` / `stream()` /
   * `arrayBuffer()`, NOT a native `Blob`. `fetch` doesn't recognise it, so
   * passing it straight through as `body` serialises it as `[object Object]`
   * and Bay rejects the upload with `not a gzip archive: gzip: invalid header`
   * — an error that points at the artifact when the artifact was fine.
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
    const bytes = new Uint8Array(await args.file.arrayBuffer());
    return await this.call<BayDeployResult>(
      "POST",
      `/apps?${query.toString()}`,
      bytes,
    );
  }

  async stop(name: string, env: string): Promise<void> {
    await this.call("POST", `/apps/${name}/${env}/stop`);
  }

  async backup(name: string, env: string): Promise<Record<string, unknown>> {
    return await this.call("POST", `/apps/${name}/${env}/backup`);
  }

  /**
   * Performs one control-API call and turns a failure into something readable.
   *
   * bay-go answers errors in Alepha's own shape, so `HttpClient` throws a real
   * `HttpError` whose `message` is the sentence Bay wrote for an operator —
   * "rebuild with `alepha build --target=bare`", "this release was unpacked by
   * an older Bay". Those are surfaced as-is rather than replaced with a generic
   * failure.
   */
  protected async call<T>(
    method: string,
    path: string,
    body?: BodyInit,
  ): Promise<T> {
    if (!this.configured) {
      throw new AlephaError(
        "BAY_TOKEN is not set — bay-ui cannot reach the Bay control API. Run `bay token` on the server and set BAY_URL / BAY_TOKEN.",
      );
    }

    const url = `${this.env.BAY_URL.replace(/\/$/, "")}${path}`;
    let res: Awaited<ReturnType<HttpClient["fetch"]>>;
    try {
      res = await this.http.fetch(url, {
        method,
        body,
        headers: { authorization: `Bearer ${this.env.BAY_TOKEN}` },
      });
    } catch (error) {
      // Bay ANSWERED — it just said no. Re-throw so its message survives:
      // relabelling a 400 as "unreachable" sends whoever is reading to check
      // the tunnel when the real problem is the artifact they uploaded.
      if (HttpError.is(error)) {
        this.log.warn("bay refused the request", {
          url,
          status: error.status,
          reason: error.message,
        });
        throw new AlephaError(`Bay refused the request: ${error.message}`);
      }
      // Only a genuine transport failure reaches here: the tunnel is down or
      // Bay is not running. Name the URL — the alternative is an operator
      // staring at "fetch failed" with no idea whether they mistyped BAY_URL.
      this.log.error("bay control api unreachable", { url, error });
      throw new AlephaError(
        `Bay control API unreachable at ${url}. Is \`bay serve\` running, and the SSH tunnel up?`,
      );
    }

    // No `data.error` check here: HttpClient throws on any status >= 400, so an
    // error body never reaches this point.
    return res.data as T;
  }
}
