import { $env, $inject, AlephaError, z } from "alepha";
import type { ClientScope } from "alepha/server/links";

import { LoreTokenStore } from "./LoreTokenStore.ts";

/**
 * The one place that answers "where is Lore, and how do I authenticate to it".
 *
 * Every `alepha lore <cmd>` builds its client from {@link scope}, so the OAuth
 * 2.0 device flow later replaces the `authorization` thunk and nothing else.
 * That containment is the whole reason this is a service rather than a header
 * inlined into whichever command needed one first.
 */
export class LoreClientService {
  /**
   * Where an app reports when it names no other, matching `SIGIL_SINK`'s own
   * default. A commons that is there if you want it and one variable away if
   * you do not.
   */
  public static readonly DEFAULT_HOSTNAME = "https://lore.alepha.dev";

  protected readonly tokens = $inject(LoreTokenStore);

  protected readonly env = $env(
    z.object({
      LORE_API_KEY: z.text({
        default: "",
        description:
          "API key for the Lore instance, from the account's API keys page. Secret.",
      }),
      LORE_URL: z.text({
        default: LoreClientService.DEFAULT_HOSTNAME,
        secret: false,
        description:
          "Origin of the Lore instance. Defaults to the public one; set it to self-host.",
      }),
      LORE_PROJECT: z.text({
        default: "",
        secret: false,
        description:
          "Default Lore project slug, overridden by --project. A workflow sets it once instead of every step passing a flag.",
      }),
    }),
  );

  /**
   * The scope every `$client<SomeController>()` in this plugin is built from.
   *
   * ⚠️ The credential is a **thunk**, resolved per request rather than here.
   * Two reasons, and the second is why it matters today: a device-flow token
   * refreshes, so a long-running process that pinned the first value would
   * work for an hour and then fail for good; and a command has to be
   * constructible on a machine with no credential at all, or `--help` would
   * fail on the very machine someone is reading it on.
   */
  public scope(): ClientScope {
    return {
      hostname: this.hostname(),
      authorization: () => this.authorization(),
    };
  }

  /**
   * Where this invocation is talking to.
   *
   * Public because one caller cannot use a `ClientScope`: `ArtifactUploader`
   * composes its own request, since the typed client would materialise the
   * whole tarball to send it. Both still come through here, which is what
   * keeps "where is Lore" one answer rather than two.
   *
   * `||`, not `??`. A schema default only fills an ABSENT variable, and
   * `LORE_URL=` in a `.env` file or a CI environment is present and empty -
   * which would otherwise resolve to an empty hostname and send the request
   * nowhere, with nothing saying why. Empty reads as "unset", which is how
   * {@link authorization} already reads an empty key.
   */
  public hostname(): string {
    return String(this.env.LORE_URL || LoreClientService.DEFAULT_HOSTNAME);
  }

  /**
   * The `Authorization` header value, resolved now.
   *
   * Never cached by a caller: see {@link scope} for why the credential is a
   * thunk everywhere it is used.
   *
   * ## ⚠️ The order is load-bearing, not cosmetic
   *
   * 1. `LORE_API_KEY`, which is what CI has.
   * 2. A device-flow token cached for this hostname, which is what a laptop
   *    has after `alepha lore login`.
   * 3. An error naming both fixes.
   *
   * **Nothing here ever starts a login.** There is no human in CI to approve a
   * device code, so a runner that fell into that flow would poll until it
   * timed out - a job that hangs and then fails for a reason its log does not
   * explain. A missing credential is a fast, legible error instead, and
   * `alepha lore login` refuses to run in CI at all.
   *
   * The key wins over the cached token deliberately. A machine that has both
   * is a developer's laptop with a key exported for a one-off, and the
   * explicit thing they just typed should be the one that is used.
   */
  public async authorization(): Promise<string> {
    const key = String(this.env.LORE_API_KEY ?? "");
    if (key) {
      return `Bearer ${key}`;
    }

    const token = await this.tokens.read(this.hostname());
    if (token) {
      return `Bearer ${token}`;
    }

    throw new AlephaError(
      `Not authenticated to ${this.hostname()}. Run \`alepha lore login\` on a machine with a browser, or set LORE_API_KEY (which is what CI does).`,
    );
  }

  /**
   * Which project this invocation is about.
   *
   * `--project` beats `LORE_PROJECT`, so a workflow names the destination once
   * and a single step can still send its build somewhere else.
   *
   * `||`, not `??`, for the reason {@link hostname} already carries: a schema
   * default only fills an ABSENT variable, and `LORE_PROJECT=` in a `.env`
   * file or a CI environment is present and empty. With `??` that resolves to
   * an empty slug, and the request goes to a URL with a hole in it rather than
   * to the error below.
   *
   * ⚠️ The throw is the thing to get right here, not the lookup. A push with
   * no project is exactly what cost Lore its own 0.28.0 artifact: this method
   * threw, the step was `continue-on-error`, and the release went green with a
   * warning annotation nobody read.
   */
  public resolveProject(flag?: string): string {
    const project = flag || String(this.env.LORE_PROJECT || "");
    if (!project) {
      throw new AlephaError(
        "No Lore project named. Pass --project <slug> (or -p), or set LORE_PROJECT in the environment.",
      );
    }
    return project;
  }
}
