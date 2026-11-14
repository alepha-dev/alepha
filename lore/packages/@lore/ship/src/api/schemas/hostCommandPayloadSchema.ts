import { type Infer, z } from "alepha";

/**
 * What a command carries besides its kind: the instance it targets on the
 * machine, and for a `deploy`, the artifact by digest.
 *
 * ⚠️ Nothing else, and in particular no secret and no bytes. This payload is
 * stored on the `host_commands` row and redelivered from there on every
 * reconnect, so anything in it lives in D1 until the sweep. The artifact
 * bytes and the environment's secret set are PULLED by the machine, by
 * command id, from the host-facing routes (#1844), which is what keeps
 * this table free of anything that must not sit in a database.
 *
 * `app` and `environment` name a Bay instance (`<app>/<environment>`), and
 * nothing here takes a path, a shell command or an argument list: the
 * vocabulary is closed and enumerated, and this is its whole argument shape.
 */
export const hostCommandPayloadSchema = z.object({
  /**
   * Empty on a `stack-deploy`, which names a stack environment instead.
   */
  app: z.string().max(100),
  environment: z.string().min(1).max(100),
  /**
   * The project slug, sent on a `deploy` so the machine can tell two projects
   * apart.
   *
   * ⚠️ **Beside `app`, never folded into it.** `HostPullController` resolves
   * this copy's secret set from the host plus `(app, environment)`, so
   * composing the pair here would break the lookup that hands an app its own
   * variables.
   *
   * On the machine it becomes the first segment of the instance name, which
   * drives the directory, the backup keys and the default subdomain at once -
   * so without it two projects that each call an app `api` and deploy
   * `production` to one Bay share all three.
   *
   * Optional because `alepha infra` sends none and because an older Lore
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
  /**
   * The stack of a `stack-deploy`, with {@link environment}: `umami` in
   * `umami/production`. Its {@link artifact} is the revision bundle.
   */
  stack: z.string().min(1).max(100).optional(),
  /**
   * A revision of the stack ON THE MACHINE to roll back to, Bay's own
   * number. Lore's rollback sends the earlier bundle instead, so this is
   * set by nothing Lore queues today; it is part of the wire Bay accepts.
   */
  revision: z.integer().min(1).optional(),
  /**
   * The stack environment's full-domain routes, which replace the machine's.
   * Not secret, so they ride in the frame; variables and registry
   * credentials are pulled by command id instead.
   */
  routes: z
    .array(
      z.object({
        service: z.string().min(1).max(100),
        domain: z.string().min(1).max(253),
      }),
    )
    .max(200)
    .optional(),
  baseDomain: z.string().max(253).optional(),
  /**
   * On a `deploy` into a stack member: the app service of {@link stack} the
   * artifact goes into, alone and blue/green (#Q2695). Bay names the member
   * `<stack>.<service>`.
   */
  service: z.string().min(1).max(100).optional(),
  /**
   * The app instance a member deploy is for. Lore's own, never sent to the
   * machine: it is how the secret pull finds that copy's variables, since a
   * stack member's host comes from its stack environment, not its row.
   */
  instanceId: z.uuid().optional(),
  /** A label on a console `backup`, kept with the backup and by retention. */
  tag: z
    .string()
    .max(64)
    .regex(/^[A-Za-z0-9._-]+$/)
    .optional(),
  /**
   * A `backup-policy`'s operator layer, the policy Bay reads in
   * `internal/backuppolicy` (`schedule`, `retention`, `window`, `onDeploy`,
   * `prune`, `verify`…). Bay validates it field by field and refuses the
   * command with its own words, so Lore bounds only its size here. `null`
   * removes the layer, and the app's own policy applies again.
   */
  policy: z.record(z.string().max(40), z.any()).nullable().optional(),
  /**
   * Which backup a `restore` or a `backup-verify` reads, the way
   * `bay restore` names one: a `key`, or the newest at or before `at` (read
   * in `tz`), optionally from another instance (`from`, `<app>/<env>`). A
   * real restore needs a `reason`, which Bay records with it.
   */
  restore: z
    .object({
      key: z.string().max(500).optional(),
      at: z.string().max(40).optional(),
      tz: z.string().max(100).optional(),
      from: z.string().max(201).optional(),
      reason: z.string().max(500).optional(),
      dryRun: z.boolean().optional(),
    })
    .optional(),
});

export type HostCommandPayload = Infer<typeof hostCommandPayloadSchema>;
