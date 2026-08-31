import { $env, $store, AlephaError, z } from "alepha";
import type { ClientScope } from "alepha/server/links";

import { loreOptions } from "../atoms/loreOptions.ts";

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

  protected readonly options = $store(loreOptions);

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
      hostname: String(this.env.LORE_URL),
      authorization: () => `Bearer ${this.requireKey()}`,
    };
  }

  /**
   * Which project this invocation is about.
   *
   * `--project` beats the config, so one repository can push into another
   * project without editing a committed file.
   */
  public resolveProject(flag?: string): string {
    const project = flag ?? this.options?.project;
    if (!project) {
      throw new AlephaError(
        'No Lore project named. Pass --project <slug>, or register lore({ project: "<slug>" }) from @alepha/lore/cli in the plugins of alepha.config.ts.',
      );
    }
    return project;
  }

  /**
   * The credential, or an error that names the variable.
   *
   * This is the single most-hit failure surface of the whole plugin: a CI job
   * whose secret is missing, or a developer running the command on a laptop
   * for the first time. It says what to set, not that something went wrong.
   */
  protected requireKey(): string {
    const key = String(this.env.LORE_API_KEY ?? "");
    if (!key) {
      throw new AlephaError(
        "LORE_API_KEY is not set. Create an API key on your Lore account's keys page and export it as LORE_API_KEY.",
      );
    }
    return key;
  }
}
