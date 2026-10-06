import { z } from "alepha";
import { $parameter } from "alepha/api/parameters";

/**
 * The bounds a deploy runs inside.
 *
 * ## ⚠️ Why these two and not the three the plan started with
 *
 * The original bound `sleepAfter`, `max_instances` and a poll step's `maxRuns`
 * into one decision. The first two were CONTAINER knobs and went with the
 * container; the poll step went with it too, because an in-process runner
 * writes its own rows and has nothing to poll.
 *
 * What survives is what a shared isolate still needs.
 */
export class DeployLimits {
  /**
   * How many deploys may run at once in one isolate.
   *
   * ⚠️ The reason CHANGED, and the number should be read against the new one.
   * It used to be container billing; it is now a 128 MB ceiling shared with
   * everything else Lore is doing. A deploy holds an unpacked artifact and its
   * modules in memory, so twenty at once is an OOM rather than a slow queue.
   */
  public static readonly DEFAULT_CONCURRENCY = 2;

  /**
   * How long one run may take before it is abandoned.
   *
   * A wedged deploy that holds a `$job` execution open forever is worse than a
   * failed one: the row stays `running`, the UI follows it, and the operator
   * cannot retry. Ten minutes is far past a real deploy - 5 to 15 seconds for a
   * redeploy, under a minute for a cold one with assets - and short enough that
   * a wedge is noticed the same day.
   */
  public static readonly DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

  /**
   * The most a run may be given, whatever an admin sets.
   *
   * ## ⚠️ Bounded by the platform, not by taste
   *
   * `deploys.run` executes inside a Cloudflare Queue consumer, which is killed
   * after **15 minutes of wall clock**. A deploy timer set past that never
   * fires: the platform kills the isolate first, the run writes nothing, and
   * the only trace is `Execution assumed crashed (recovered by sweep)` half an
   * hour later (blight #616, #Q2344). The parameter used to accept 60 minutes.
   *
   * Thirteen, not fifteen: what runs before the timer starts (the gate, the
   * artifact lookup, opening the secrets) and the failure write after it
   * fires both spend the same fifteen minutes, and a margin of two is what
   * leaves the run room to report its own timeout.
   */
  public static readonly MAX_TIMEOUT_MS = 13 * 60 * 1000;

  /**
   * Overridable from `/admin/parameters` without a redeploy, the way
   * `ProjectLimits` is: a ceiling that can only be changed by shipping is a
   * ceiling nobody adjusts during the incident it is causing.
   *
   * ⚠️ Both keys are OPTIONAL, for the reason `ProjectLimits` writes down at
   * length: `ParameterProvider` returns a version saved under an older schema
   * hash as-is, so a key added later comes back `undefined` from an override an
   * admin already set - and a required key would then be `undefined` with the
   * type claiming otherwise.
   */
  public readonly limits = $parameter({
    name: "lore.deploy.limits",
    description:
      "How many deploys may run at once, and how long one may take. Both bound a shared 128 MB isolate.",
    schema: z.object({
      concurrency: z.integer().min(1).max(20).optional(),
      // Capped below the queue consumer's 15 minutes; see MAX_TIMEOUT_MS.
      timeoutMs: z
        .integer()
        .min(30_000)
        .max(DeployLimits.MAX_TIMEOUT_MS)
        .optional(),
    }),
    default: {
      concurrency: DeployLimits.DEFAULT_CONCURRENCY,
      timeoutMs: DeployLimits.DEFAULT_TIMEOUT_MS,
    },
  });

  public async concurrency(): Promise<number> {
    return (
      (await this.limits.get()).concurrency ?? DeployLimits.DEFAULT_CONCURRENCY
    );
  }

  /**
   * The deploy timer, never past {@link MAX_TIMEOUT_MS}.
   *
   * ⚠️ Clamped here as well as in the schema: `ParameterProvider` hands back a
   * version saved under an older schema as-is, so an override of 30 minutes
   * set while the ceiling was 60 still reads as 30.
   */
  public async timeoutMs(): Promise<number> {
    return Math.min(
      (await this.limits.get()).timeoutMs ?? DeployLimits.DEFAULT_TIMEOUT_MS,
      DeployLimits.MAX_TIMEOUT_MS,
    );
  }
}
