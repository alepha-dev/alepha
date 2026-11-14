import { type Infer, z } from "alepha";

import type { HostCommandPayload } from "./hostCommandPayloadSchema.ts";
import type { HostCommandKind } from "./hostCommandValues.ts";

/** Which backup to read: a `key`, or the newest at or before `at` (read in `tz`). */
const pointFields = {
  key: z.string().min(1).max(500).optional(),
  at: z.string().min(1).max(40).optional(),
  tz: z.string().min(1).max(100).optional(),
};

/**
 * The backup verbs a person can send to one instance on a Bay, from the
 * host page or from a project's Backups tab. The two endpoints differ only
 * in how they name the instance, so they share this body and
 * {@link backupCommandInput}, and cannot drift apart.
 *
 * ⚠️ `backup` is here and NOT in the host endpoint's `restart`/`stop`
 * group: a union takes the first branch that parses, and that one would strip
 * the `tag`.
 *
 * ⚠️ Two fields are the host owner's only, and the project controller
 * refuses them: a restore's `from` (another instance's data), and the whole
 * `backup-policy` verb, which writes Bay's OPERATOR layer, wider in its bounds
 * than an app's (keep everything forever, override what the app declared), on
 * a bucket the owner pays for. A project declares its policy at deploy, as
 * the app layer, instead.
 */
const variants = <T extends NonNullable<Parameters<typeof z.object>[0]>>(
  target: T,
) =>
  [
    z.object({
      ...target,
      kind: z.literal("backup"),
      tag: z
        .string()
        .min(1)
        .max(64)
        .regex(/^[A-Za-z0-9._-]+$/)
        .optional(),
    }),
    z.object({ ...target, kind: z.enum(["backups-list", "target-probe"]) }),
    z.object({ ...target, kind: z.literal("backup-verify"), ...pointFields }),
    z.object({
      ...target,
      kind: z.literal("backup-policy"),
      /** The operator layer; `null` clears it. Bay validates every field. */
      policy: z.record(z.string().max(40), z.any()).nullable(),
    }),
    z.object({
      ...target,
      kind: z.literal("restore"),
      ...pointFields,
      // Another instance's data (`<app>/<env>`). Only the host's console may
      // ask, under host:update in its home project. On a shared Bay a project member must never reach another
      // project's backups, and an unknown key would be stripped silently,
      // restoring the caller's own data instead: so the body keeps the field
      // and the project controller refuses it outright.
      from: z.string().min(3).max(201).optional(),
      reason: z.string().max(500).optional(),
      dryRun: z.boolean().optional(),
    }),
  ] as const;

export const hostBackupCommandBodySchema = z.union(variants({}));

/**
 * The same, naming the instance as the host page does: `app` is the
 * machine's own instance name, project segment included.
 */
export const hostBackupCommandTargetedSchema = z.union(
  variants({
    app: z.string().min(1).max(100),
    environment: z.string().min(1).max(100),
  }),
);

export type HostBackupCommandBody = Infer<typeof hostBackupCommandBodySchema>;

export type HostBackupCommandTargeted = Infer<
  typeof hostBackupCommandTargetedSchema
>;

export const HOST_BACKUP_COMMAND_KINDS = [
  "backup",
  "backups-list",
  "target-probe",
  "backup-verify",
  "backup-policy",
  "restore",
] as const satisfies readonly HostCommandKind[];

/**
 * The backup verbs refused while the Bay is offline rather than queued. A
 * restore or a policy change delivered up to a day later, once nobody is
 * looking, is worse than an error: the person asking has moved on, and the
 * data or the schedule changes under whoever is there then.
 */
export const BACKUP_KINDS_REFUSED_OFFLINE: readonly string[] = [
  "restore",
  "backup-policy",
];

/**
 * The queued command for a backup body, aimed at the instance Bay knows as
 * `app/environment` (the machine's name, project segment included).
 */
export const backupCommandInput = (
  body: HostBackupCommandBody | HostBackupCommandTargeted,
  app: string,
  environment: string,
): { kind: HostCommandKind; payload: HostCommandPayload } => {
  const base = { app, environment };
  switch (body.kind) {
    case "backup":
      return {
        kind: "backup",
        payload: { ...base, ...(body.tag ? { tag: body.tag } : {}) },
      };
    case "backups-list":
    case "target-probe":
      return { kind: body.kind, payload: base };
    case "backup-verify": {
      const ask = point(body);
      return {
        kind: "backup-verify",
        payload: {
          ...base,
          ...(Object.keys(ask).length ? { restore: ask } : {}),
        },
      };
    }
    case "backup-policy":
      return {
        kind: "backup-policy",
        payload: { ...base, policy: body.policy },
      };
    case "restore":
      return {
        kind: "restore",
        payload: {
          ...base,
          restore: {
            ...point(body),
            ...("from" in body && body.from ? { from: body.from } : {}),
            ...(body.reason?.trim() ? { reason: body.reason.trim() } : {}),
            ...(body.dryRun ? { dryRun: true } : {}),
          },
        },
      };
  }
};

const point = (body: { key?: string; at?: string; tz?: string }) => ({
  ...(body.key ? { key: body.key } : {}),
  ...(body.at ? { at: body.at } : {}),
  ...(body.tz ? { tz: body.tz } : {}),
});
