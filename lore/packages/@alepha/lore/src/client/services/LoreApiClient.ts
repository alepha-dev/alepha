import { $env, AlephaError, z } from "alepha";
import { $logger } from "alepha/logger";

/**
 * The HTTP seam every client call goes through: where Lore is, who is calling,
 * and what a refusal reads as.
 *
 * ## ⚠️ Paths, not `$client`, and that is a hard constraint rather than taste
 *
 * `$client<AppController>` would put a type from the private `lore` workspace
 * into this package's exported signatures, and `scripts/check-dts.ts` fails the
 * build when an emitted `.d.ts` names that workspace: it is `private`, never
 * published, and the failure would land on whoever installs the tarball rather
 * than on us. `@alepha/lore/cli` gets away with `$client` because those types
 * stay internal to a binary; a library's return types are its interface.
 *
 * So this addresses endpoints by path and declares its own result shapes, which
 * is exactly what `ArtifactUploader` already does for the same reason. The cost
 * is real and worth stating: **a path or a field renamed in Lore breaks this
 * silently at runtime rather than loudly at compile time.** The paths are
 * collected here, in one class, so there is one place to look.
 *
 * ## ⚠️ Nothing here touches a filesystem
 *
 * No token store, no `HOME`, no `node:` anything. `lore login`'s device flow is
 * for a laptop; a server calling Lore holds `LORE_API_KEY` and nothing else.
 * That keeps this subpath importable from a Cloudflare Worker, which is where
 * an app that provisions tenants on demand is most likely to run.
 */
export class LoreApiClient {
  protected readonly log = $logger();

  /**
   * The three variables a caller sets, named exactly as CI already names them
   * so one deployment configures both halves.
   */
  protected readonly env = $env(
    z.object({
      LORE_URL: z
        .text({
          default: "https://lore.alepha.dev",
          secret: false,
          description:
            "Origin of the Lore instance. Defaults to the public one; set it to self-host.",
        })
        .optional(),
      LORE_API_KEY: z
        .text({
          default: "",
          description:
            "API key the calling server authenticates with. Its user needs `app:manage` and `deploy:manage` in the project.",
        })
        .optional(),
      LORE_PROJECT: z
        .text({
          default: "",
          secret: false,
          description:
            "Project slug every call is about, unless one is passed explicitly.",
        })
        .optional(),
    }),
  );

  /**
   * The origin, without a trailing slash.
   */
  public origin(): string {
    return String(this.env.LORE_URL || "https://lore.alepha.dev").replace(
      /\/+$/,
      "",
    );
  }

  /**
   * Which project a call is about.
   *
   * ⚠️ `||` and never `??`: a schema default only fills an ABSENT variable, and
   * `LORE_PROJECT=` in a deployment's environment is present and empty. With
   * `??` that resolves to the empty string and the request goes to a URL with a
   * hole in it rather than to this error.
   */
  public project(named?: string): string {
    const project = named || String(this.env.LORE_PROJECT || "");
    if (!project) {
      throw new AlephaError(
        "No Lore project named. Pass `project` to the call, or set LORE_PROJECT in the environment.",
      );
    }
    return project;
  }

  /**
   * The project's integer id, which every project-scoped endpoint takes.
   *
   * A numeric value is taken as an id directly, so a caller that already holds
   * one pays no round trip. Everything else is a slug and is resolved.
   */
  public async projectId(named?: string): Promise<number> {
    const project = this.project(named);
    if (/^\d+$/.test(project)) {
      return Number(project);
    }
    const found = await this.request<{ id?: number }>(
      "GET",
      `/api/projects/by-slug/${encodeURIComponent(project)}`,
    );
    if (!found?.id) {
      throw new AlephaError(
        `No Lore project named "${project}". Check the slug in its URL, or set LORE_PROJECT.`,
      );
    }
    return found.id;
  }

  /**
   * One call, with the bearer attached and a refusal turned into words.
   *
   * ⚠️ **Lore's own message is what surfaces.** Every refusal on the deploy
   * path is written to be read by somebody who often cannot fix it from where
   * they are - the runtime gate names the build to produce, and the credential
   * and kill-switch clauses name whose estate it is. Reporting a status code
   * instead throws away the only actionable half.
   */
  public async request<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const key = String(this.env.LORE_API_KEY || "");
    if (!key) {
      throw new AlephaError(
        "LORE_API_KEY is not set, so this server cannot authenticate to Lore.",
      );
    }

    const res = await fetch(`${this.origin()}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${key}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    if (!res.ok) {
      throw new AlephaError(await this.reason(res, method, path), {
        // Carried so a caller can branch on "does not exist yet" without
        // matching on a sentence. The 404 from `getApp` is the one case a
        // caller legitimately treats as data.
        cause: { status: res.status } as never,
      });
    }

    // 204 and an empty body are both legitimate answers here; `json()` on
    // either throws, which would report a successful call as a failure.
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /**
   * Whether a thrown error was a given HTTP status.
   *
   * `request` puts the status on `cause`, so a caller reads it without
   * importing anything of this package's internals.
   */
  public static statusOf(error: unknown): number | undefined {
    const cause = (error as { cause?: { status?: number } } | undefined)?.cause;
    return typeof cause?.status === "number" ? cause.status : undefined;
  }

  /**
   * Lore's message when it sent one, and something honest when it did not.
   */
  protected async reason(
    res: Response,
    method: string,
    path: string,
  ): Promise<string> {
    let message = "";
    try {
      const body = (await res.json()) as { message?: string };
      message = typeof body?.message === "string" ? body.message : "";
    } catch {
      // A gateway or a proxy answering HTML is not a Lore refusal and has no
      // message to read; the status and the path are then all there is.
    }
    return message || `Lore answered ${res.status} to ${method} ${path}.`;
  }
}
