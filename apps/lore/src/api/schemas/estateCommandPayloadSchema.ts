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
  artifact: z
    .object({
      id: z.uuid(),
      sha256: z.string().min(64).max(64),
      size: z.integer().min(0),
    })
    .optional(),
});

export type EstateCommandPayload = Infer<typeof estateCommandPayloadSchema>;
