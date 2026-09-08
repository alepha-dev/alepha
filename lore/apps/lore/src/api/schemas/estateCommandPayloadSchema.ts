import { type Infer, z } from "alepha";

/**
 * What a command carries besides its kind: the instance it targets on the
 * machine, and for a `deploy`, the artifact by digest.
 *
 * ⚠️ Nothing else, and in particular no secret and no bytes. This payload is
 * stored on the `estate_commands` row and redelivered from there on every
 * reconnect, so anything in it lives in D1 until the sweep. The artifact
 * bytes and the environment's secret set are PULLED by the machine, by
 * command id, from the estate-facing routes (#1844), which is what keeps
 * this table free of anything that must not sit in a database.
 *
 * `app` and `environment` name a Bay instance (`<app>/<environment>`), and
 * nothing here takes a path, a shell command or an argument list: the
 * vocabulary is closed and enumerated, and this is its whole argument shape.
 */
export const estateCommandPayloadSchema = z.object({
  app: z.string().min(1).max(100),
  environment: z.string().min(1).max(100),
  /**
   * The project slug, sent on a `deploy` so the machine can tell two projects
   * apart.
   *
   * ⚠️ **Beside `app`, never folded into it.** `EstatePullController` resolves
   * this copy's secret set from the estate plus `(app, environment)`, so
   * composing the pair here would break the lookup that hands an app its own
   * variables.
   *
   * On the machine it becomes the first segment of the instance name, which
   * drives the directory, the backup keys and the default subdomain at once -
   * so without it two projects that each call an app `api` and deploy
   * `production` to one Bay share all three.
   *
   * Optional because `alepha platform` sends none and because an older Lore
   * sent none: absent degrades to `<app>-<env>`, the previous behaviour.
   */
  project: z.string().min(1).max(100).optional(),
  artifact: z
    .object({
      id: z.uuid(),
      sha256: z.string().min(64).max(64),
      size: z.integer().min(0),
    })
    .optional(),
  /**
   * How much of the journal a `logs` command asks for.
   *
   * Three bounded numbers and one bounded string, never a path and never a
   * shell fragment. `lines` stops at 2000 because that is Bay's own
   * `maxLogRequest`: the control API answers in memory while holding a lock
   * nothing else can take. `grep` is a pattern Bay runs through Go's RE2,
   * which has no backtracking, so a hostile one is linear rather than a way
   * to hang the machine.
   */
  logs: z
    .object({
      lines: z.integer().min(1).max(2000),
      sinceSeconds: z.integer().min(0).max(604_800).optional(),
      grep: z.string().max(200).optional(),
    })
    .optional(),
});

export type EstateCommandPayload = Infer<typeof estateCommandPayloadSchema>;
